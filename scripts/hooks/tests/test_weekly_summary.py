"""Tests for scripts/weekly_summary.py and the weekly workflow's delivery contract.

This module exists because the summary builder used to be a `python - <<'PY'`
heredoc inside `.github/workflows/weekly.yml`, where nothing could reach it: no
linter, no type checker, no test. It had rotted accordingly -- a YAML block
scalar is literal, so the doubled backslashes in it (`"\\n"`, `r"(\\d+)%"`,
`r"^\\s*(?:async\\s+)?def\\s+test_"`) were real doubled backslashes in the
Python source, and the job had been emitting a one-line report of visible `\n`
with a permanently-zero quarantine count and a permanently-"N/A" mutation score.
Several tests below are regressions for exactly those three escapes.

The rest lock the fail-loud contract: absent evidence must not be rendered as a
zero, and a missing pinned issue must fail the job rather than print a hint into
a log nobody reads.
"""

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
# read_mutation_report -- regression for the `\\d` regex
# --------------------------------------------------------------------------


def test_read_mutation_report_extracts_the_score_and_tail(tmp_path):
    body = "\n".join(f"line {n}" for n in range(1, 8)) + "\nMutation score: 73%\n"
    report = weekly_summary.read_mutation_report(_write(tmp_path / "m.txt", body))
    assert report.score == "73%"
    assert report.tail.splitlines() == [
        "line 4",
        "line 5",
        "line 6",
        "line 7",
        "Mutation score: 73%",
    ]


def test_read_mutation_report_is_advisory_when_absent(tmp_path):
    # The `mutation` job is continue-on-error by design, so a missing report is
    # a visible N/A rather than a hard failure.
    report = weekly_summary.read_mutation_report(tmp_path / "absent.txt")
    assert report.score == weekly_summary.MUTATION_UNAVAILABLE
    assert report.tail == weekly_summary.MUTATION_UNAVAILABLE


def test_read_mutation_report_without_a_percentage(tmp_path):
    report = weekly_summary.read_mutation_report(_write(tmp_path / "m.txt", "no score here\n"))
    assert report.score == weekly_summary.MUTATION_UNAVAILABLE
    assert report.tail == "no score here"


# --------------------------------------------------------------------------
# find_p95_baseline
# --------------------------------------------------------------------------


def test_find_p95_baseline_returns_the_first_matching_line(tmp_path):
    doc = "# Baselines\n\nsome prose\n- P95 latency: 120ms\n- p95 other: 999ms\n"
    assert (
        weekly_summary.find_p95_baseline(_write(tmp_path / "b.md", doc)) == "- P95 latency: 120ms"
    )


def test_find_p95_baseline_when_absent(tmp_path):
    assert weekly_summary.find_p95_baseline(tmp_path / "nope.md") == (
        weekly_summary.BASELINE_UNAVAILABLE
    )
    doc = _write(tmp_path / "b.md", "nothing relevant\n")
    assert weekly_summary.find_p95_baseline(doc) == weekly_summary.BASELINE_UNAVAILABLE


# --------------------------------------------------------------------------
# build_summary -- regression for the `\\n` writes
# --------------------------------------------------------------------------


def test_build_summary_emits_real_newlines_not_literal_backslash_n():
    summary = weekly_summary.build_summary(
        weekly_summary.Counts(passed=4, failed=3, skipped=3),
        quarantined=2,
        mutation=weekly_summary.MutationReport(score="73%", tail="tail line"),
        p95_baseline="- P95 latency: 120ms",
    )
    assert "\\n" not in summary, "the heredoc's doubled escapes are back"
    assert len(summary.splitlines()) > 5
    assert summary.startswith("# Weekly Test Reliability Report")


def test_build_summary_reports_every_figure():
    summary = weekly_summary.build_summary(
        weekly_summary.Counts(passed=4, failed=3, skipped=3),
        quarantined=2,
        mutation=weekly_summary.MutationReport(score="73%", tail="tail line"),
        p95_baseline="- P95 latency: 120ms",
    )
    assert "- Total tests: 4 passed / 3 failed / 3 skipped" in summary
    assert "- Flake rate: 2 tests in `tests/quarantine/`" in summary
    assert "- Mutation score: 73%" in summary
    assert "- P95 latency baseline: - P95 latency: 120ms" in summary
    assert "tail line" in summary


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
        "--mutation-report",
        str(tmp_path / "absent-mutation.txt"),
        "--baseline",
        str(tmp_path / "absent-baseline.md"),
        "--out",
        str(out),
    ]


def test_main_writes_the_summary(tmp_path):
    junit = _write(tmp_path / "j.xml", TESTSUITES_XML)
    out = tmp_path / "reports" / "weekly-summary.md"
    assert weekly_summary.main(_main_args(tmp_path, [junit], out)) == 0
    written = out.read_text(encoding="utf-8")
    assert "- Total tests: 4 passed / 3 failed / 3 skipped" in written
    assert f"- Mutation score: {weekly_summary.MUTATION_UNAVAILABLE}" in written


def test_main_sums_multiple_junit_reports(tmp_path):
    first = _write(tmp_path / "a.xml", BARE_TESTSUITE_XML)
    second = _write(tmp_path / "b.xml", MULTI_SUITE_XML)
    out = tmp_path / "summary.md"
    assert weekly_summary.main(_main_args(tmp_path, [first, second], out)) == 0
    assert "- Total tests: 7 passed / 4 failed / 1 skipped" in out.read_text(encoding="utf-8")


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


def test_weekly_workflow_fails_when_the_pinned_issue_is_missing():
    text = _weekly_text()
    step = text.split("Post summary to the pinned reliability issue", 1)
    assert len(step) == 2, "weekly.yml has no 'Post summary to the pinned reliability issue' step."
    body = step[1]
    assert "exit 1" in body, (
        "the post-summary step must fail when no pinned issue is found. Printing a "
        "hint and passing left the job green while the report went nowhere."
    )
    assert "gh issue comment" in body
    assert "gh issue create" not in text, (
        "a failing weekly run is the signal here; this workflow must not raise issues."
    )


def test_weekly_report_job_keeps_least_privilege_issue_scope():
    text = _weekly_text()
    assert "issues: write" in text, (
        "the reliability job needs issues:write to comment on the pinned issue."
    )
    assert "pull-requests: write" not in text
    assert "contents: write" not in text
