"""Build the Weekly Hardening reliability summary from the CI report artifacts.

Extracted from the ``run: python - <<'PY'`` heredoc that used to live inside
``.github/workflows/weekly.yml``. Python embedded in a YAML block scalar is not
linted, not type-checked and not testable, and that copy had rotted: every
backslash in it was doubled (``"\\n"``, ``r"(\\d+)%"``,
``r"^\\s*(?:async\\s+)?def\\s+test_"``) because a block scalar is literal and
nothing ever re-escaped it. The report was therefore written as a single line of
visible ``\n``, the quarantine count was pinned at 0 and the mutation score was
pinned at "N/A" -- for as long as the job has existed.

Fail-loud contract
------------------
A JUnit report that the workflow's ``needs:`` guarantees is present is
**required**. Treating a missing one as ``(0, 0, 0)`` printed "0 failed": a
pass-shaped line manufactured from absent evidence. Genuinely advisory inputs
(the mutation report, whose job is ``continue-on-error``, and the performance
baseline) stay optional -- but they resolve to a visible "N/A" / "Not found",
never to a zero that reads as a pass.

Stdlib only, so the hook-tests gate can exercise it before the venv exists.
"""

from __future__ import annotations

import argparse
import re
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

MUTATION_UNAVAILABLE = "N/A"
BASELINE_UNAVAILABLE = "Not found"

# `def test_x` / `async def test_x` at any indentation.
TEST_DEF_RE = re.compile(r"^\s*(?:async\s+)?def\s+test_", re.MULTILINE)
MUTATION_SCORE_RE = re.compile(r"(\d+)%")


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
class MutationReport:
    """Advisory mutation-testing figures; both default to a visible sentinel."""

    score: str = MUTATION_UNAVAILABLE
    tail: str = MUTATION_UNAVAILABLE


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


def read_mutation_report(path: Path, tail_lines: int = 5) -> MutationReport:
    """Read the advisory mutation report.

    The weekly `mutation` job is `continue-on-error` by design, so a missing
    report is reported as "N/A" instead of failing the summary.
    """
    if not path.is_file():
        return MutationReport()
    body = path.read_text(encoding="utf-8", errors="ignore")
    lines = [line for line in body.splitlines() if line.strip()]
    match = MUTATION_SCORE_RE.search(body)
    return MutationReport(
        score=f"{match.group(1)}%" if match else MUTATION_UNAVAILABLE,
        tail="\n".join(lines[-tail_lines:]) if lines else MUTATION_UNAVAILABLE,
    )


def find_p95_baseline(path: Path) -> str:
    """First line mentioning p95 in the baseline doc, or a visible sentinel."""
    if not path.is_file():
        return BASELINE_UNAVAILABLE
    with path.open(encoding="utf-8", errors="ignore") as handle:
        for line in handle:
            if "p95" in line.lower():
                return line.strip()
    return BASELINE_UNAVAILABLE


def build_summary(
    counts: Counts,
    quarantined: int,
    mutation: MutationReport,
    p95_baseline: str,
) -> str:
    """Render the Markdown comment body posted to the pinned issue."""
    return "\n".join(
        [
            "# Weekly Test Reliability Report",
            "",
            f"- Total tests: {counts.passed} passed / {counts.failed} failed / "
            f"{counts.skipped} skipped",
            f"- Flake rate: {quarantined} tests in `tests/quarantine/`",
            f"- Mutation score: {mutation.score}",
            f"- P95 latency baseline: {p95_baseline}",
            "",
            "## Mutation report tail",
            "",
            "```text",
            mutation.tail,
            "```",
            "",
        ]
    )


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
        "--mutation-report",
        default=Path("reports/mutation/mutation-report.txt"),
        type=Path,
        help="Advisory mutation report; missing is reported as N/A.",
    )
    parser.add_argument(
        "--baseline",
        default=Path("docs/evidence/performance-baselines.md"),
        type=Path,
        help="Advisory performance-baseline doc scanned for a p95 line.",
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
    except SummaryInputError as exc:
        # `::error::` surfaces on the run's summary page, not just in the log.
        print(f"::error::{exc}", file=sys.stderr)
        return 1

    summary = build_summary(
        counts,
        quarantined,
        read_mutation_report(args.mutation_report),
        find_p95_baseline(args.baseline),
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(summary, encoding="utf-8")
    print(f"Wrote {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
