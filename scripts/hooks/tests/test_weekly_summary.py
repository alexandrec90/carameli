"""Tests for scripts/weekly_summary.py and the weekly workflow's delivery contract.

This module exists because the summary builder used to be a `python - <<'PY'`
heredoc inside `.github/workflows/weekly.yml`, where nothing could reach it: no
linter, no type checker, no test. It had rotted accordingly -- a YAML block
scalar is literal, so the doubled backslashes in it (`"\\n"`, `r"(\\d+)%"`,
`r"^\\s*(?:async\\s+)?def\\s+test_"`) were real doubled backslashes in the
Python source, and the job had been emitting a one-line report of visible `\n`
with a permanently-zero quarantine count and a permanently-"N/A" mutation score.
Several tests below are regressions for exactly those escapes.

The rest lock the fail-loud contract -- absent evidence must not be rendered as a
zero -- and the workflow shape that let the mutation job report "N/A" for its
whole life while staying green.
"""

import configparser
import json
import re

import pytest
from conftest import REPO_ROOT, load_module

weekly_summary = load_module("scripts/weekly_summary.py")

WEEKLY_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "weekly.yml"

TESTSUITES_XML = """<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="pytest" tests="10" failures="2" errors="1" skipped="3" />
</testsuites>
"""

BARE_TESTSUITE_XML = """<?xml version="1.0" encoding="utf-8"?>
<testsuite name="pytest" tests="4" failures="1" errors="0" skipped="0" />
"""

MULTI_SUITE_XML = """<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="a" tests="3" failures="1" errors="0" skipped="0" />
  <testsuite name="b" tests="5" failures="0" errors="2" skipped="1" />
</testsuites>
"""


def _write(path, text: str):
    path.write_text(text, encoding="utf-8")
    return path


# --------------------------------------------------------------------------
# parse_junit
# --------------------------------------------------------------------------


def test_parse_junit_reads_the_testsuites_wrapper(tmp_path):
    counts = weekly_summary.parse_junit(_write(tmp_path / "j.xml", TESTSUITES_XML))
    # failures + errors == 3 failed; 10 - 3 - 3 == 4 passed.
    assert (counts.passed, counts.failed, counts.skipped) == (4, 3, 3)


def test_parse_junit_reads_a_bare_testsuite_root(tmp_path):
    counts = weekly_summary.parse_junit(_write(tmp_path / "j.xml", BARE_TESTSUITE_XML))
    assert (counts.passed, counts.failed, counts.skipped) == (3, 1, 0)


def test_parse_junit_aggregates_every_suite(tmp_path):
    counts = weekly_summary.parse_junit(_write(tmp_path / "j.xml", MULTI_SUITE_XML))
    # a: 2 passed / 1 failed. b: 2 passed / 2 failed / 1 skipped.
    assert (counts.passed, counts.failed, counts.skipped) == (4, 3, 1)


def test_parse_junit_raises_on_a_missing_report(tmp_path):
    # The fix: a missing artifact used to return (0, 0, 0), so the summary
    # printed "0 failed" -- a pass-shaped line built from no evidence at all.
    with pytest.raises(weekly_summary.SummaryInputError) as exc:
        weekly_summary.parse_junit(tmp_path / "absent.xml")
    assert "missing" in str(exc.value)
    assert "zero" in str(exc.value)


def test_parse_junit_raises_on_unparseable_xml(tmp_path):
    with pytest.raises(weekly_summary.SummaryInputError):
        weekly_summary.parse_junit(_write(tmp_path / "j.xml", "<testsuite tests="))


# --------------------------------------------------------------------------
# count_quarantined_tests -- regression for the `\\s` regex
# --------------------------------------------------------------------------


def test_count_quarantined_tests_matches_sync_and_async_defs(tmp_path):
    _write(
        tmp_path / "test_flaky.py",
        "import pytest\n\n\ndef test_one():\n    pass\n\n\nasync def test_two():\n    pass\n",
    )
    _write(tmp_path / "test_nested.py", "class T:\n    def test_indented(self):\n        pass\n")
    assert weekly_summary.count_quarantined_tests(tmp_path) == 3


def test_count_quarantined_tests_ignores_package_markers(tmp_path):
    _write(tmp_path / "__init__.py", "def test_not_counted():\n    pass\n")
    assert weekly_summary.count_quarantined_tests(tmp_path) == 0


def test_count_quarantined_tests_recurses(tmp_path):
    nested = tmp_path / "sub"
    nested.mkdir()
    _write(nested / "test_deep.py", "def test_deep():\n    pass\n")
    assert weekly_summary.count_quarantined_tests(tmp_path) == 1


def test_count_quarantined_tests_raises_when_the_directory_is_gone(tmp_path):
    with pytest.raises(weekly_summary.SummaryInputError):
        weekly_summary.count_quarantined_tests(tmp_path / "nope")


# --------------------------------------------------------------------------
# read_mutation_stats / survivors_by_module
# --------------------------------------------------------------------------

# The shape `mutmut export-cicd-stats` writes to mutants/mutmut-cicd-stats.json.
CICD_STATS = {
    "killed": 716,
    "survived": 249,
    "total": 965,
    "no_tests": 0,
    "skipped": 0,
    "suspicious": 0,
    "timeout": 0,
    "check_was_interrupted_by_user": 0,
    "segfault": 0,
}

# The shape `mutmut results` prints: survivors and other non-killed mutants.
# mutmut mangles a method as x<LATERAL CLICK>Class<LATERAL CLICK>method.
SURVIVORS_TXT = """\
    app.core.session.x_get_session__mutmut_3: survived
    app.api.webhooks.call_status.x_handle__mutmut_1: survived
    app.api.webhooks.call_status.x\N{LATIN LETTER LATERAL CLICK}Router\N{LATIN LETTER LATERAL CLICK}post__mutmut_7: survived
    app.services.call_sync.x_sync__mutmut_9: no tests
    app.services.call_sync.x_sync__mutmut_10: timeout
"""


def _stats(**overrides):
    return weekly_summary.MutationStats(
        **{
            key: CICD_STATS[key]
            for key in ("killed", "survived", "timeout", "suspicious", "no_tests", "skipped")
        }
        | {"total": CICD_STATS["total"]}
        | overrides
    )


def test_read_mutation_stats_parses_the_cicd_export(tmp_path):
    stats = weekly_summary.read_mutation_stats(_write(tmp_path / "s.json", json.dumps(CICD_STATS)))
    assert stats == _stats()
    assert stats.score == pytest.approx(716 / 965 * 100)


def test_mutation_score_matches_mutmuts_badge_formula():
    # (killed + timeout) / (total - skipped): a timed-out mutant was caught, a
    # skipped one was never tested.
    assert _stats(killed=6, timeout=2, skipped=2, total=10).score == pytest.approx(100.0)


def test_mutation_score_is_none_when_nothing_was_tested():
    assert _stats(total=4, skipped=4).score is None


def test_read_mutation_stats_is_none_when_absent(tmp_path):
    # Absent only when the mutation job failed, which already turned the run red.
    assert weekly_summary.read_mutation_stats(tmp_path / "absent.json") is None


@pytest.mark.parametrize(
    "body", ["not json", "[]", '{"killed": 1}', '{"killed": "x", "survived": 0, "total": 1}']
)
def test_read_mutation_stats_raises_on_corrupt_stats(tmp_path, body):
    with pytest.raises(weekly_summary.SummaryInputError):
        weekly_summary.read_mutation_stats(_write(tmp_path / "s.json", body))


def test_format_mutation_line_spells_out_every_outcome():
    line = weekly_summary.format_mutation_line(_stats(timeout=3, suspicious=1, no_tests=2))
    assert line == (
        "- Mutation score: 74.5% of 965 mutants -- 716 killed, 249 survived, "
        "3 timed out, 1 suspicious, 2 with no covering test"
    )


def test_format_mutation_line_without_stats_or_tested_mutants():
    assert weekly_summary.format_mutation_line(None).startswith("- Mutation score: N/A (")
    assert weekly_summary.format_mutation_line(_stats(total=0)).startswith(
        "- Mutation score: N/A of 0 mutants"
    )


def test_survivors_by_module_counts_only_survivors_most_first(tmp_path):
    counts = weekly_summary.survivors_by_module(_write(tmp_path / "r.txt", SURVIVORS_TXT))
    assert counts == {"app.api.webhooks.call_status": 2, "app.core.session": 1}
    assert list(counts) == ["app.api.webhooks.call_status", "app.core.session"]


def test_survivors_by_module_ignores_noise_and_missing_files(tmp_path):
    assert weekly_summary.survivors_by_module(tmp_path / "absent.txt") == {}
    noise = "Saved CI/CD stats\nnodots: survived\n\n"
    assert weekly_summary.survivors_by_module(_write(tmp_path / "r.txt", noise)) == {}


# --------------------------------------------------------------------------
# build_summary -- regression for the `\\n` writes
# --------------------------------------------------------------------------


def _summary(mutation=None, survivors=None):
    return weekly_summary.build_summary(
        weekly_summary.Counts(passed=4, failed=3, skipped=3),
        quarantined=2,
        mutation=_stats() if mutation is None else mutation,
        survivors={"app.core.session": 5} if survivors is None else survivors,
    )


def test_build_summary_emits_real_newlines_not_literal_backslash_n():
    summary = _summary()
    assert "\\n" not in summary, "the heredoc's doubled escapes are back"
    assert len(summary.splitlines()) > 5
    assert summary.startswith("# Weekly reliability summary")


def test_build_summary_reports_every_figure():
    summary = _summary()
    assert "- Migration round-trip + resilience: 4 passed / 3 failed / 3 skipped" in summary
    assert "- Quarantined tests: 2 in `tests/quarantine/`" in summary
    assert "- Mutation score: 74.2% of 965 mutants -- 716 killed, 249 survived" in summary
    assert "| `app.core.session` | 5 |" in summary


def test_build_summary_shows_na_not_zero_without_mutation_stats():
    summary = weekly_summary.build_summary(
        weekly_summary.Counts(passed=1), quarantined=0, mutation=None, survivors={}
    )
    assert f"- Mutation score: {weekly_summary.MUTATION_UNAVAILABLE}" in summary
    assert "Surviving mutants" not in summary


def test_build_summary_has_no_latency_line():
    # performance-baselines.md is all TBD, and the old p95 scrape reported that
    # table's header row as the baseline. Re-add it when there is a measurement.
    assert "p95" not in _summary().lower()


# --------------------------------------------------------------------------
# main / CLI contract
# --------------------------------------------------------------------------


def _main_args(tmp_path, junit_paths, out):
    args = []
    for junit in junit_paths:
        args += ["--junit", str(junit)]
    quarantine = tmp_path / "quarantine"
    quarantine.mkdir(exist_ok=True)
    return [
        *args,
        "--quarantine-dir",
        str(quarantine),
        "--mutation-stats",
        str(tmp_path / "mutmut-cicd-stats.json"),
        "--mutation-survivors",
        str(tmp_path / "mutation-survivors.txt"),
        "--out",
        str(out),
    ]


def test_main_writes_the_summary(tmp_path):
    junit = _write(tmp_path / "j.xml", TESTSUITES_XML)
    out = tmp_path / "reports" / "weekly-summary.md"
    assert weekly_summary.main(_main_args(tmp_path, [junit], out)) == 0
    written = out.read_text(encoding="utf-8")
    assert "- Migration round-trip + resilience: 4 passed / 3 failed / 3 skipped" in written
    assert f"- Mutation score: {weekly_summary.MUTATION_UNAVAILABLE}" in written


def test_main_reports_the_mutation_artifacts(tmp_path):
    junit = _write(tmp_path / "j.xml", TESTSUITES_XML)
    _write(tmp_path / "mutmut-cicd-stats.json", json.dumps(CICD_STATS))
    _write(tmp_path / "mutation-survivors.txt", SURVIVORS_TXT)
    out = tmp_path / "summary.md"
    assert weekly_summary.main(_main_args(tmp_path, [junit], out)) == 0
    written = out.read_text(encoding="utf-8")
    assert "- Mutation score: 74.2% of 965 mutants" in written
    assert "| `app.api.webhooks.call_status` | 2 |" in written


def test_main_fails_on_corrupt_mutation_stats(tmp_path, capsys):
    junit = _write(tmp_path / "j.xml", TESTSUITES_XML)
    _write(tmp_path / "mutmut-cicd-stats.json", "{")
    out = tmp_path / "summary.md"
    assert weekly_summary.main(_main_args(tmp_path, [junit], out)) == 1
    assert not out.exists()
    assert "::error::" in capsys.readouterr().err


def test_main_sums_multiple_junit_reports(tmp_path):
    first = _write(tmp_path / "a.xml", BARE_TESTSUITE_XML)
    second = _write(tmp_path / "b.xml", MULTI_SUITE_XML)
    out = tmp_path / "summary.md"
    assert weekly_summary.main(_main_args(tmp_path, [first, second], out)) == 0
    assert "7 passed / 4 failed / 1 skipped" in out.read_text(encoding="utf-8")


def test_main_fails_and_writes_nothing_when_a_report_is_missing(tmp_path, capsys):
    out = tmp_path / "summary.md"
    rc = weekly_summary.main(_main_args(tmp_path, [tmp_path / "absent.xml"], out))
    assert rc == 1
    assert not out.exists(), "a summary must not be produced from absent evidence"
    assert "::error::" in capsys.readouterr().err


def test_main_requires_at_least_one_junit_report(tmp_path):
    with pytest.raises(SystemExit) as exc:
        weekly_summary.main(["--out", str(tmp_path / "s.md")])
    assert exc.value.code == 2


def test_help_exits_zero_without_running(tmp_path):
    # --help prints usage and exits; it must never fall through to the default action.
    with pytest.raises(SystemExit) as exc:
        weekly_summary.main(["--help"])
    assert exc.value.code == 0


def test_unknown_argument_exits_two():
    with pytest.raises(SystemExit) as exc:
        weekly_summary.main(["--not-a-flag"])
    assert exc.value.code == 2


# --------------------------------------------------------------------------
# Workflow contract
# --------------------------------------------------------------------------


def _weekly_text() -> str:
    return WEEKLY_WORKFLOW.read_text(encoding="utf-8")


def test_weekly_workflow_calls_the_extracted_script():
    text = _weekly_text()
    assert "scripts/weekly_summary.py" in text, (
        "weekly.yml should build its summary via scripts/weekly_summary.py."
    )
    assert "python - <<" not in text, (
        "weekly.yml reintroduced an inline Python heredoc. Python in a YAML block "
        "scalar is unlinted and untestable, and the last copy silently rotted."
    )


def _job(name: str) -> str:
    """One top-level job of weekly.yml, up to the next job, without comment lines.

    Comments are dropped so a job may explain what it no longer does in the
    words these tests forbid.
    """
    jobs = _weekly_text().split("\njobs:\n", 1)[1]
    blocks = re.split(r"\n(?=  [a-z][\w-]*:\n)", "\n" + jobs)
    for block in blocks:
        if block.strip().startswith(f"{name}:"):
            return "\n".join(
                line for line in block.splitlines() if not line.lstrip().startswith("#")
            )
    raise AssertionError(f"weekly.yml has no `{name}` job")


def test_weekly_summary_goes_to_the_run_page_not_an_issue():
    # The summary used to be posted to a standing issue that the job forced to
    # stay open: ten identical comments in eight weeks, alerting on nothing.
    text = _weekly_text()
    assert '>> "$GITHUB_STEP_SUMMARY"' in _job("weekly-reliability-report")
    assert "gh issue" not in text, (
        "weekly.yml must not post to, create or reopen issues; a failed run reaches the "
        "issue list through scheduled-failure-issue.yml."
    )
    assert "issues: write" not in text
    assert "pull-requests: write" not in text
    assert "contents: write" not in text


def test_mutation_job_cannot_fail_quietly():
    # `mutmut run || true` plus `continue-on-error` kept this job green for its
    # whole life while it mutated nothing. Survivors do not fail `mutmut run`;
    # only a broken run does, and that must reach the run's verdict.
    job = _job("mutation")
    assert "|| true" not in job
    assert "continue-on-error" not in job
    assert "mutmut export-cicd-stats" in job, "the summary reads the score from that JSON"


def test_mutation_job_has_a_disposable_database():
    # The selected tests use the `client` fixture, so a job without Postgres can
    # only ever fail its stats run. tests/conftest.py also refuses a database whose
    # name does not mark it disposable.
    job = _job("mutation")
    assert "postgres:" in job
    assert re.search(r"DATABASE_URL: \S+/\w+_test\b", job)


def test_mutation_job_runs_one_worker_against_its_one_database():
    # Workers share the database and each session TRUNCATEs it, so parallel
    # workers fail each other's tests: 65 of 965 mutants read as killed that a
    # single worker lets survive. A score built on that is inflated, not noisy.
    assert re.search(r"mutmut run --max-children 1\b", _job("mutation"))


# --------------------------------------------------------------------------
# setup.cfg [mutmut] -- regression for "0 files mutated"
# --------------------------------------------------------------------------


def _mutmut_option(name: str) -> list[str]:
    parser = configparser.ConfigParser()
    parser.read(REPO_ROOT / "setup.cfg", encoding="utf-8")
    raw = parser.get("mutmut", name, fallback="")
    # mutmut 3 splits a setup.cfg list on newlines only, exactly like this.
    return [line for line in raw.split("\n") if line]


@pytest.mark.parametrize(
    "option", ["source_paths", "only_mutate", "pytest_add_cli_args_test_selection", "also_copy"]
)
def test_mutmut_lists_name_paths_that_exist(option):
    # `paths_to_mutate = a.py,b.py` was read as the single path "a.py,b.py", so
    # mutmut matched no file and every weekly run mutated nothing.
    entries = _mutmut_option(option)
    assert entries, f"setup.cfg [mutmut] has no {option}"
    for entry in entries:
        assert "," not in entry, f"{option}: one entry per line, not comma-joined: {entry!r}"
        assert (REPO_ROOT / entry).exists(), f"{option} names {entry}, which does not exist"


def test_mutmut_mutates_only_files_inside_its_source_paths():
    roots = _mutmut_option("source_paths")
    for target in _mutmut_option("only_mutate"):
        assert any(target.startswith(f"{root}/") for root in roots), target


def test_mutmut_config_uses_no_key_mutmut_3_ignores():
    # `runner` is gone in mutmut 3 (it was `docker compose exec ...`, which a CI
    # runner cannot run anyway); the other two only warn, then misparse.
    parser = configparser.ConfigParser()
    parser.read(REPO_ROOT / "setup.cfg", encoding="utf-8")
    for key in ("runner", "paths_to_mutate", "tests_dir"):
        assert not parser.has_option("mutmut", key), f"setup.cfg [mutmut] still sets {key}"
