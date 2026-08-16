#!/usr/bin/env python3
"""Runs the local integration suite (tests/local_e2e/) and writes actionable failures to
logs/local-e2e-failures.log for AI-agent consumption.

This suite covers the INVERTED topology: Carameli running remotely behind a tunnel,
VanillaLand running locally in IIS. It costs nothing (no telephony) and is safe to
re-run. Configure it with `.env.local-e2e` (see `.env.local-e2e.example`) and read
docs/operations/local-integration-testing.md before the first run.

Two things this runner handles that a bare `pytest tests/local_e2e` does not:

1. `--confcutdir`. The suite must not load `tests/conftest.py`, which imports alembic,
   SQLAlchemy and `app.main`. None of that is installed on the VanillaLand machine, and
   requiring it would defeat the point of a dependency-light suite.
2. Interpreter discovery. The VanillaLand machine has no project venv and often no
   Python at all, so this falls back to an ephemeral `uv run` environment carrying just
   pytest and httpx.

Usage: python scripts/run-local-e2e.py [-k EXPR] [extra pytest args]
   or: uv run --python 3.12 --no-project scripts/run-local-e2e.py
"""

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import script_common

REPO_ROOT = Path(__file__).resolve().parents[1]
ARTIFACT = REPO_ROOT / "logs" / "local-e2e-failures.log"
SUITE = "tests/local_e2e"

# Just enough to import tests/local_e2e/. Deliberately not the project requirements:
# adding them would drag in asyncpg/alembic and reintroduce the dependency this suite
# was designed to avoid.
EPHEMERAL_DEPS = ("pytest", "pytest-asyncio", "pytest-timeout", "httpx")

_RESULT_RE = re.compile(r"^(tests[\\/].+?::\S+)\s+(PASSED|FAILED|SKIPPED|ERROR|XFAIL|XPASS)")

# Failure signatures worth translating into the specific thing to go fix. Ordered: the
# first match wins, so put the more specific patterns first.
_FIX_HINTS: tuple[tuple[str, str], ...] = (
    (
        r"Invalid column name 'VoipVendor'|Invalid object name 'dbo\.tblVoipLineVendor'",
        "The local VanillaSoft database predates this branch's VoIP-vendor routing. "
        "Apply the schema sync in docs/operations/local-integration-testing.md "
        "(tblCustomer.VoipVendor + dbo.tblVoipLineVendor).",
    ),
    (
        r"VS_CARAMELI_NOTIFY_SECRET does not match|CarameliNotifySecret",
        "Set CarameliNotifySecret in AppCode/VanillaSoft.CloudliApi/Web.config to the "
        "same value as the remote's CARAMELI_NOTIFY_SECRET, then recycle the IIS app "
        "pool. An empty appSetting rejects every notify with 401. If the secret IS set, "
        "suspect a stale build: a binary predating CarameliSignatureAttribute still "
        "guards these routes with X-Cloudli-Auth and rejects signed requests "
        "identically — see the 401 section of "
        "docs/operations/local-integration-testing.md.",
    ),
    (
        r"CARAMELI_API_KEY was not accepted|wrong Bearer key was accepted",
        "Check CarameliApiKey / CarameliApiBaseUrl in AppCode/Vanillasoft.Web/Web.config "
        "against the remote Carameli's E2E customer key.",
    ),
    (
        r"ngrok's browser interstitial|ngrok-skip-browser-warning",
        "A request reached ngrok's warning page instead of Carameli. Every request needs "
        "the 'ngrok-skip-browser-warning' header — see helpers.NGROK_SKIP_HEADER.",
    ),
    (
        r"is not deployed on the local CloudliApi",
        "Rebuild AppCode/VanillaSoft.CloudliApi into the IIS application; the branch's "
        "CarameliNotifyController is not being served.",
    ),
    (
        r"outside the replay window was accepted|replay protection",
        "Replay protection is off or the two machines' clocks disagree by more than the "
        "5-minute window. Check the clock on both boxes before touching the code.",
    ),
    (
        r"not reaching local Elasticsearch",
        "The VanillaSoft log channel is down: confirm NLog.Targets.ElasticSearch is in "
        "the CloudliApi bin directory, NLog.config points at the local ES, and the IIS "
        "app pool has recycled since the config changed.",
    ),
    (
        r"does not reach the local CloudliApi|fault is in the tunnel",
        "The tunnel exposing local IIS points somewhere else. Re-check its target port "
        "and that VS_PUBLIC_BASE_URL includes the /voip application path.",
    ),
    (
        r"ConnectError|ConnectTimeout|Connection refused|actively refused",
        "A host was unreachable. Check the remote tunnel is still up (free ngrok URLs "
        "change on restart) and that IIS and the SQL container are running.",
    ),
)


def resolve_pytest_cmd(
    venv_python: Path,
    has_uv: bool,
) -> tuple[list[str], str] | tuple[None, str]:
    """Return (command prefix, description) for invoking pytest, or (None, reason).

    Prefers the project venv when it exists so a full dev machine uses its pinned
    versions; falls back to an ephemeral `uv run` environment for the VanillaLand
    machine, which has neither the project installed nor Python on PATH.
    """
    if venv_python.exists():
        return [str(venv_python), "-m", "pytest"], "project venv (.venv)"
    if has_uv:
        cmd = ["uv", "run", "--python", "3.12", "--no-project"]
        for dep in EPHEMERAL_DEPS:
            cmd += ["--with", dep]
        cmd.append("pytest")
        return cmd, "ephemeral uv environment"
    return None, (
        "no .venv and no uv on PATH — create the venv (`uv venv --python 3.12`) or install uv"
    )


def build_pytest_args(extra: list[str]) -> list[str]:
    """Arguments after the interpreter prefix.

    `--confcutdir` is the load-bearing one: without it pytest walks up to
    `tests/conftest.py` and dies importing alembic before a single test runs.
    """
    return [
        SUITE,
        f"--confcutdir={SUITE}",
        "-v",
        "--tb=short",
        "--no-header",
        "-p",
        "no:warnings",
        *extra,
    ]


def count_results(lines: list[str]) -> tuple[int, int, int]:
    """Return (passed, failed, skipped) counts from verbose pytest output."""
    passed = failed = skipped = 0
    for line in lines:
        match = _RESULT_RE.match(line)
        if not match:
            continue
        status = match.group(2)
        if status == "PASSED":
            passed += 1
        elif status in ("FAILED", "ERROR"):
            failed += 1
        else:
            skipped += 1
    return passed, failed, skipped


def find_unreported_tests(lines: list[str]) -> int:
    """How many collected tests never reported a result. 0 when everything is accounted for.

    A `timeout_method = thread` kill (pytest.ini sets one globally) terminates the test
    without emitting PASSED/FAILED, so the test *disappears* from the counts rather than
    failing. Left unnoticed that reads as a smaller, greener run. Comparing pytest's own
    "collected N items" against the results we parsed surfaces it.
    """
    collected = None
    for line in lines:
        match = re.search(r"collected (\d+) items?", line)
        if match:
            collected = int(match.group(1))
            break
    if collected is None:
        return 0
    passed, failed, skipped = count_results(lines)
    return max(0, collected - (passed + failed + skipped))


def collect_statuses(lines: list[str]) -> list[tuple[str, str]]:
    """Per-test `[state] nodeid` pairs for the shared runner report."""
    states = {
        "PASSED": script_common.PASS,
        "FAILED": script_common.FAIL,
        "ERROR": script_common.FAIL,
    }
    statuses = []
    for line in lines:
        match = _RESULT_RE.match(line)
        if match:
            statuses.append((states.get(match.group(2), script_common.SKIP), match.group(1)))
    return statuses


def get_fix_hint(blob: str) -> str:
    """Infer the specific thing to go change from a failure block's text.

    The suite's assertion messages are written to make this possible — they name the
    config key or the component at fault rather than only reporting a status code.
    """
    for pattern, hint in _FIX_HINTS:
        if re.search(pattern, blob):
            return hint
    return ""


def extract_failure_blocks(lines: list[str]) -> list[list[str]]:
    """Slice pytest's `=== FAILURES ===` section into one block per failing test."""
    try:
        start = next(index for index, line in enumerate(lines) if re.match(r"=+ FAILURES =+", line))
    except StopIteration:
        return []

    blocks: list[list[str]] = []
    current: list[str] = []
    for line in lines[start + 1 :]:
        if re.match(r"=+ (short test summary|warnings summary|slowest|\d+ (failed|passed))", line):
            break
        if re.match(r"_{5,} .+ _{5,}", line):
            if current:
                blocks.append(current)
            current = [line.strip("_ ")]
            continue
        current.append(line)
    if current:
        blocks.append(current)
    return blocks


def build_artifact(lines: list[str], exit_code: int, fail_count: int) -> str:
    """Build the failures artifact. An empty string clears it, meaning 'clean run'.

    Written for an agent to act on directly: each failure keeps its assertion text —
    which for this suite includes the honest receiver's real error body — plus a fix
    hint pointing at the config key or component responsible.
    """
    if exit_code == 0 and fail_count == 0:
        return ""

    blocks = extract_failure_blocks(lines)
    if not blocks:
        tail = "\n".join(lines[-40:])
        return (
            "Local integration suite failed without producing a FAILURES section "
            f"(exit code {exit_code}). Last output:\n\n{tail}\n"
        )

    sections = [
        "# Local integration failures (tests/local_e2e)",
        "",
        "Topology: remote Carameli over a tunnel, local VanillaLand in IIS.",
        "Runbook: docs/operations/local-integration-testing.md",
        "",
    ]

    unreported = find_unreported_tests(lines)
    if unreported:
        sections += [
            f"## {unreported} collected test(s) never reported a result",
            "",
            "Almost always a pytest-timeout kill: pytest.ini sets `timeout = 60` with",
            "`timeout_method = thread`, which terminates the test instead of failing it, so",
            "it vanishes from the counts rather than showing up red. Give the test its own",
            "`@pytest.mark.timeout(...)` exceeding whatever it polls for.",
            "",
        ]
    for block in blocks:
        title = block[0].strip()
        body = "\n".join(line for line in block[1:] if line.strip())
        sections.append(f"## {title}")
        sections.append("")
        sections.append(body)
        hint = get_fix_hint("\n".join(block))
        if hint:
            sections.append("")
            sections.append(f"FIX: {hint}")
        sections.append("")
    return "\n".join(sections) + "\n"


def echo(line: str) -> None:
    """Print a captured line without ever letting the console encoding kill the run.

    A Windows console defaults to cp1252, and this suite's assertion messages carry
    en/em dashes and whatever bytes a failing endpoint echoed back. An unencodable
    character would otherwise raise mid-stream and abort `main` *before* the artifact is
    written — turning a legible test failure into no report at all.
    """
    try:
        print(line)
    except UnicodeEncodeError:
        encoding = sys.stdout.encoding or "ascii"
        print(line.encode(encoding, errors="replace").decode(encoding, errors="replace"))


def stream_lines(stream) -> list[str]:
    """Echo each line live and return them all, so progress is visible during the run."""
    collected: list[str] = []
    for raw in iter(stream.readline, ""):
        line = raw.rstrip("\r\n")
        echo(line)
        collected.append(line)
    return collected


def main(argv=None) -> int:
    extra = list(sys.argv[1:] if argv is None else argv)

    # The artifact is UTF-8 regardless; this only affects what the console shows.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")

    venv_python = script_common.venv_exe("python")
    prefix, runner = resolve_pytest_cmd(venv_python, shutil.which("uv") is not None)

    script_common.print_suite_header(
        "Local Integration Tests", ARTIFACT, [f"Runner   : {runner}", f"Target   : {SUITE}", ""]
    )

    if prefix is None:
        print(runner, file=sys.stderr)
        return 1

    # Force the child to emit UTF-8. Piped on Windows it would otherwise use the ANSI
    # code page, and every non-ASCII character in an assertion message — the suite's
    # messages are full of dashes and quoted response bodies — would reach the artifact
    # as a replacement character.
    child_env = {**os.environ, "PYTHONIOENCODING": "utf-8"}

    proc = subprocess.Popen(
        [*prefix, *build_pytest_args(extra)],
        cwd=REPO_ROOT,
        env=child_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    lines = stream_lines(proc.stdout) if proc.stdout is not None else []
    exit_code = proc.wait()

    passed, failed, skipped = count_results(lines)

    # Everything skipped means the suite is unconfigured, not broken. Reporting that as a
    # failure would train the reader to ignore this runner's exit code.
    if passed == 0 and failed == 0 and skipped > 0:
        return script_common.emit_report(
            noun="LOCAL E2E",
            artifact_path=ARTIFACT,
            statuses=[(script_common.SKIP, "local-e2e (unconfigured: see .env.local-e2e.example)")],
            artifact_text="",
            failed=False,
            counts=(passed, failed, skipped),
            unit="tests",
        )

    return script_common.emit_report(
        noun="LOCAL E2E",
        artifact_path=ARTIFACT,
        statuses=collect_statuses(lines),
        artifact_text=build_artifact(lines, exit_code, failed),
        failed=exit_code != 0,
        counts=(passed, failed, skipped),
        unit="tests",
    )


if __name__ == "__main__":
    sys.exit(main())
