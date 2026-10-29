"""Build the Weekly Hardening reliability summary from the CI report artifacts.

Extracted from the ``run: python - <<'PY'`` heredoc that used to live inside
``.github/workflows/weekly.yml``. Python embedded in a YAML block scalar is not
linted, not type-checked and not testable, and that copy had rotted: every
backslash in it was doubled (``"\\n"``, ``r"(\\d+)%"``,
``r"^\\s*(?:async\\s+)?def\\s+test_"``) because a block scalar is literal and
nothing ever re-escaped it. The report was therefore written as a single line of
visible ``\n``, the quarantine count was pinned at 0 and the mutation score was
pinned at "N/A" -- for as long as the job has existed.

Where it lands
--------------
The workflow appends this Markdown to the run's step summary. It used to be
posted as a comment on a standing "Weekly Test Reliability Report" issue, which
collected ten identical comments between 2026-09-06 and 2026-10-25 and had to be
kept open by force. A failing weekly run is already filed as an issue by
``scheduled-failure-issue.yml``, so the summary is reference material, not an
alert, and the step summary is where reference material for a run belongs.

Mutation figures
----------------
Read from ``mutmut export-cicd-stats``'s JSON, not scraped from text. The old
scrape looked for the first ``NN%`` in ``mutmut results`` output, which prints
no percentage at all, so the score could never have been anything but "N/A"
even on a run that worked. The score is mutmut's own badge formula:
``(killed + timeout) / (total - skipped)``.

Fail-loud contract
------------------
A JUnit report that the workflow's ``needs:`` guarantees is present is
**required**. Treating a missing one as ``(0, 0, 0)`` printed "0 failed": a
pass-shaped line manufactured from absent evidence. The mutation stats are
absent only when the ``mutation`` job failed, which has already turned the run
red, so they resolve to a visible "N/A" -- never to a zero that reads as a pass.
Present-but-unparseable stats are corrupt evidence and fail the summary.

Stdlib only, so the hook-tests gate can exercise it before the venv exists.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

MUTATION_UNAVAILABLE = "N/A"

# `def test_x` / `async def test_x` at any indentation.
TEST_DEF_RE = re.compile(r"^\s*(?:async\s+)?def\s+test_", re.MULTILINE)
# One `mutmut results` line: `    app.core.session.x_get__mutmut_3: survived`.
MUTANT_LINE_RE = re.compile(r"^\s*(?P<name>\S+):\s*(?P<status>[\w ]+?)\s*$")


class SummaryInputError(RuntimeError):
    """A required report artifact is missing, unreadable, or not parseable."""


@dataclass(frozen=True)
class Counts:
    """Aggregate test outcomes across one or more JUnit reports."""

    passed: int = 0
    failed: int = 0
    skipped: int = 0

    def __add__(self, other: Counts) -> Counts:
        return Counts(
            passed=self.passed + other.passed,
            failed=self.failed + other.failed,
            skipped=self.skipped + other.skipped,
        )


@dataclass(frozen=True)
class MutationStats:
    """The fields of ``mutants/mutmut-cicd-stats.json`` the summary reports."""

    killed: int
    survived: int
    timeout: int
    suspicious: int
    no_tests: int
    skipped: int
    total: int

    @property
    def score(self) -> float | None:
        """mutmut's badge score, or ``None`` when no mutant was tested."""
        tested = self.total - self.skipped
        if tested <= 0:
            return None
        return (self.killed + self.timeout) / tested * 100


def _suite_counts(attrib: dict[str, str]) -> Counts:
    tests = int(attrib.get("tests", 0))
    failed = int(attrib.get("failures", 0)) + int(attrib.get("errors", 0))
    skipped = int(attrib.get("skipped", 0))
    return Counts(passed=max(tests - failed - skipped, 0), failed=failed, skipped=skipped)


def parse_junit(path: Path) -> Counts:
    """Count one JUnit XML report.

    Raises ``SummaryInputError`` when the file is absent or unparseable rather
    than returning zeros -- a report that cannot be read is an unknown result,
    not a clean one.
    """
    if not path.is_file():
        raise SummaryInputError(
            f"required JUnit report {path} is missing -- the upstream job never uploaded "
            "its artifact. Fix that job; this summary will not count it as zero."
        )
    try:
        # First-party input: pytest writes this XML earlier in the same workflow
        # run and it is downloaded from that run's own artifacts. defusedxml is
        # host-only (requirements-dev) and this script must stay stdlib-only to
        # run in the pre-venv hook-tests gate and on the runner.
        root = ET.parse(path).getroot()  # noqa: S314 - first-party pytest artifact
    except ET.ParseError as exc:
        raise SummaryInputError(f"{path} is not parseable JUnit XML: {exc}") from exc
    # pytest wraps suites in <testsuites>; plainer writers emit a bare
    # <testsuite>. `iter` yields the root itself when it is the suite, so both
    # shapes aggregate identically.
    suites = list(root.iter("testsuite"))
    if not suites:
        return _suite_counts(root.attrib)
    total = Counts()
    for suite in suites:
        total = total + _suite_counts(suite.attrib)
    return total


def count_quarantined_tests(quarantine_dir: Path) -> int:
    """Count test functions parked under the quarantine tree.

    An empty quarantine directory honestly counts 0; a *missing* one means the
    layout moved, which makes the count unknown -- so that raises.
    """
    if not quarantine_dir.is_dir():
        raise SummaryInputError(
            f"quarantine directory {quarantine_dir} does not exist, so the flake count is "
            "unknown. Point --quarantine-dir at the real path."
        )
    total = 0
    for path in sorted(quarantine_dir.rglob("*.py")):
        if path.name == "__init__.py":
            continue
        total += len(TEST_DEF_RE.findall(path.read_text(encoding="utf-8")))
    return total


def read_mutation_stats(path: Path) -> MutationStats | None:
    """Read ``mutmut export-cicd-stats`` output; ``None`` when the job left none."""
    if not path.is_file():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return MutationStats(
            killed=int(data["killed"]),
            survived=int(data["survived"]),
            timeout=int(data.get("timeout", 0)),
            suspicious=int(data.get("suspicious", 0)),
            no_tests=int(data.get("no_tests", 0)),
            skipped=int(data.get("skipped", 0)),
            total=int(data["total"]),
        )
    except (json.JSONDecodeError, KeyError, TypeError, ValueError) as exc:
        raise SummaryInputError(f"{path} is not mutmut CI/CD stats JSON: {exc}") from exc


def survivors_by_module(path: Path) -> dict[str, int]:
    """Count surviving mutants per module from ``mutmut results`` output.

    A mutant is named ``<module>.<mangled function>__mutmut_<n>``, so the module
    is everything before the last dot. A missing file yields no rows.
    """
    if not path.is_file():
        return {}
    counts: Counter[str] = Counter()
    for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        match = MUTANT_LINE_RE.match(line)
        if match and match.group("status") == "survived" and "." in match.group("name"):
            counts[match.group("name").rsplit(".", 1)[0]] += 1
    return dict(sorted(counts.items(), key=lambda item: (-item[1], item[0])))


def format_mutation_line(stats: MutationStats | None) -> str:
    if stats is None:
        return f"- Mutation score: {MUTATION_UNAVAILABLE} (the `mutation` job left no stats)"
    score = stats.score
    shown = MUTATION_UNAVAILABLE if score is None else f"{score:.1f}%"
    return (
        f"- Mutation score: {shown} of {stats.total} mutants -- {stats.killed} killed, "
        f"{stats.survived} survived, {stats.timeout} timed out, "
        f"{stats.suspicious} suspicious, {stats.no_tests} with no covering test"
    )


def build_summary(
    counts: Counts,
    quarantined: int,
    mutation: MutationStats | None,
    survivors: dict[str, int],
) -> str:
    """Render the Markdown appended to the weekly run's step summary."""
    lines = [
        "# Weekly reliability summary",
        "",
        f"- Migration round-trip + resilience: {counts.passed} passed / "
        f"{counts.failed} failed / {counts.skipped} skipped",
        f"- Quarantined tests: {quarantined} in `tests/quarantine/`",
        format_mutation_line(mutation),
        "",
    ]
    if survivors:
        lines += [
            "## Surviving mutants by module",
            "",
            "| Module | Survived |",
            "| --- | ---: |",
            *(f"| `{module}` | {count} |" for module, count in survivors.items()),
            "",
            "Each survivor is named in the `mutation-report` artifact's "
            "`mutation-survivors.txt`. To see one's diff, run `mutmut run` on Linux or "
            "WSL (mutmut needs `fork`), then `mutmut show <name>`.",
            "",
        ]
    return "\n".join(lines)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Build the weekly test-reliability summary from CI report artifacts.",
    )
    parser.add_argument(
        "--junit",
        action="append",
        required=True,
        type=Path,
        metavar="PATH",
        help="Required JUnit XML report; repeat for each upstream job.",
    )
    parser.add_argument(
        "--quarantine-dir",
        default=Path("tests/quarantine"),
        type=Path,
        help="Directory scanned for quarantined test functions.",
    )
    parser.add_argument(
        "--mutation-stats",
        default=Path("reports/mutation/mutmut-cicd-stats.json"),
        type=Path,
        help="`mutmut export-cicd-stats` JSON; missing is reported as N/A.",
    )
    parser.add_argument(
        "--mutation-survivors",
        default=Path("reports/mutation/mutation-survivors.txt"),
        type=Path,
        help="`mutmut results` output, tallied into survivors per module.",
    )
    parser.add_argument(
        "--out",
        default=Path("reports/weekly-summary.md"),
        type=Path,
        help="Where to write the rendered Markdown summary.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        counts = Counts()
        for junit in args.junit:
            counts = counts + parse_junit(junit)
        quarantined = count_quarantined_tests(args.quarantine_dir)
        mutation = read_mutation_stats(args.mutation_stats)
    except SummaryInputError as exc:
        # `::error::` surfaces on the run's summary page, not just in the log.
        print(f"::error::{exc}", file=sys.stderr)
        return 1

    summary = build_summary(
        counts, quarantined, mutation, survivors_by_module(args.mutation_survivors)
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(summary, encoding="utf-8")
    print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
