#!/usr/bin/env python3
"""Runs Playwright E2E tests and writes actionable failures to logs/e2e-failures.log
for AI-agent consumption. On pass (or environment skip) clears the artifact.

Requires the backend (docker compose up) and Vite dev server (npm run dev) to be
reachable. The pure parsing/classification helpers are unit-tested in
`scripts/hooks/tests/test_run_e2e.py`.

Usage: python scripts/run-e2e.py [--headed | --cross-browser]
"""
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

from script_common import venv_exe

REPO_ROOT = Path(__file__).resolve().parents[1]
ARTIFACT = REPO_ROOT / "logs" / "e2e-failures.log"
VITE_URL = "http://localhost:5173"
BACKEND_HEALTH = "http://127.0.0.1:8000/health"

_RESULT_RE = re.compile(r"^(tests[\\/].+?::\S+)\s+(PASSED|FAILED|SKIPPED|ERROR|XFAIL|XPASS)")
_BLOCK_HEADER_RE = re.compile(r"^_{3,}\s+(.+?)\s+_{3,}$")


def reachable(url: str, timeout: int = 5) -> bool:
    try:
        urllib.request.urlopen(url, timeout=timeout)
        return True
    except OSError:
        return False


def get_fix_hint(blob: str) -> str:
    """Infer a specific fix hint from a failure block's error text."""
    checks = [
        (r"CORS policy|Access-Control-Allow-Origin",
         "CORS misconfiguration -- ensure Access-Control-Allow-Origin is not wildcard '*' "
         "when credentials mode is 'include'"),
        (r"status[=\s]+5\d\d|Internal Server Error|502|503",
         "backend endpoint returning 5xx -- check the route handler and server logs"),
        (r"status[=\s]+4\d\d|Not Found|Forbidden|Unauthorized",
         "backend endpoint returning 4xx -- check auth, route registration, and request payload"),
        (r"Timeout|TimeoutError|waiting for selector|waiting for navigation",
         "page element or navigation timed out -- check that the app renders the expected DOM"),
        (r"net::ERR_CONNECTION_REFUSED|ECONNREFUSED|net::ERR_EMPTY_RESPONSE|socket hang up",
         "server not reachable -- ensure the backend and frontend dev servers are running "
         "before running E2E tests"),
        (r"ElementNotFound|ElementHandle|locator\.",
         "DOM element not found -- check selectors against the current page markup"),
    ]
    for pattern, hint in checks:
        if re.search(pattern, blob):
            return hint
    return "read the test to understand intent, then fix the underlying application code"


def _truncate(line: str, limit: int = 300) -> str:
    return line[:297] + "..." if len(line) > limit else line


def remove_diff_noise(block: list[str]) -> list[str]:
    """Strip pytest diff noise, keeping file:line context + the first assertion error."""
    cleaned: list[str] = []
    hit_assertion = False
    for line in block:
        if re.match(r"^\S.*:\d+:", line) or (re.match(r"^\s{4}\S", line) and not line.startswith("E ")):
            cleaned.append(line)
            continue
        if not hit_assertion and re.match(r"^E\s+(Assertion|assert|\+\s+where|.*Error:)", line):
            cleaned.append(_truncate(line))
            hit_assertion = True
            continue
        if hit_assertion and re.match(r"^E\s+\+\s+where", line):
            cleaned.append(_truncate(line))
            continue
        if hit_assertion and re.match(r"^E\s", line):
            continue
        if line.startswith("E ") and not hit_assertion:
            cleaned.append(_truncate(line))
    return cleaned


def count_results(lines: list[str]) -> tuple[int, int, int]:
    """Return (passed, failed, skipped) counts from verbose pytest output."""
    passed = failed = skipped = 0
    for line in lines:
        m = _RESULT_RE.match(line)
        if not m:
            continue
        status = m.group(2)
        if status == "PASSED":
            passed += 1
        elif status in ("FAILED", "ERROR"):
            failed += 1
        else:
            skipped += 1
    return passed, failed, skipped


def is_server_down(all_output: str, fail_count: int) -> bool:
    """True if every failure is a connection error (environment, not code)."""
    return (
        fail_count > 0
        and re.search(r"net::ERR_EMPTY_RESPONSE|net::ERR_CONNECTION_REFUSED|ECONNREFUSED|socket hang up",
                      all_output) is not None
        and re.search(r"AssertionError|assert |status[=\s]+[45]\d\d", all_output) is None
    )


def build_artifact(lines: list[str], exit_code: int, fail_count: int) -> str:
    """Build the structured failures artifact. Empty string means 'clear it'."""
    if exit_code == 0:
        return ""

    if fail_count > 0:
        sections: list[str] = []
        current_test = ""
        current_lines: list[str] = []
        in_block = False

        def flush():
            if current_test and current_lines:
                sections.append(f"# {current_test}")
                sections.append(f"# fix: {get_fix_hint(chr(10).join(current_lines))}")
                sections.extend(remove_diff_noise(current_lines))
                sections.append("")

        for line in lines:
            header = _BLOCK_HEADER_RE.match(line)
            if header:
                flush()
                current_test = header.group(1)
                current_lines = []
                in_block = True
                continue
            if in_block and re.match(r"^={3,}\s+(short test summary|warnings summary)", line):
                in_block = False
                continue
            if in_block and line.strip():
                if re.match(r"^(FAILED|={3,}|\.venv|--\s+Docs:)", line):
                    continue
                current_lines.append(line)
        flush()

        summary = [line for line in lines if re.match(r"^FAILED\s+", line)]
        if summary:
            sections += ["# summary", *summary, ""]

        if sections:
            return "\n".join(sections) + "\n"

    # Non-test failure (collection/import error) or no parsed blocks: filtered fallback.
    filtered = [line for line in lines
                if not re.match(r"^\.venv", line)
                and not re.match(r"^--\s+Docs:", line)
                and line.strip()]
    head = ["# e2e-collection-error",
            "# fix: check that all test imports resolve and fixtures are available"]
    return "\n".join(head + filtered) + "\n"


def main(argv=None) -> int:
    args = sys.argv[1:] if argv is None else argv
    headed = "--headed" in args or "-Headed" in args
    cross_browser = "--cross-browser" in args or "-CrossBrowser" in args

    ARTIFACT.parent.mkdir(parents=True, exist_ok=True)
    venv_python = venv_exe("python")
    if not venv_python.exists():
        print("Venv not found at .venv/ -- create it first: python -m venv .venv", file=sys.stderr)
        return 1

    mode = "cross-browser" if cross_browser else ("headed" if headed else "headless")
    print("\n=== Carameli E2E Tests ===")
    print(f"Artifact : {ARTIFACT}")
    print(f"Runner   : Playwright (chromium, {mode})\n")

    # Pre-flight: both servers must be reachable.
    if not reachable(VITE_URL, 3) or not reachable(BACKEND_HEALTH, 5):
        ARTIFACT.write_text("", encoding="utf-8")
        print("  [environment] E2E skipped -- one or more servers are not reachable.")
        return 0

    if cross_browser:
        cmd = ["docker", "compose", "exec", "-T", "app", "pytest", "tests/e2e/",
               "--browser=chromium", "--browser=firefox", "--browser=webkit", "-v", "--tb=short"]
        print("Running E2E tests...")
        code = subprocess.run(cmd, cwd=REPO_ROOT).returncode
        if code == 0:
            ARTIFACT.write_text("", encoding="utf-8")
        else:
            ARTIFACT.write_text(
                "# e2e-cross-browser\n"
                "# fix: inspect docker compose app logs and failing Playwright specs\n"
                + " ".join(cmd) + "\n", encoding="utf-8")
        return code

    cmd = [str(venv_python), "-m", "pytest", "tests/e2e/", "-v", "--tb=short",
           "--no-header", "-p", "no:warnings"]
    if headed:
        cmd.append("--headed")

    print("Running E2E tests...")
    proc = subprocess.run(cmd, cwd=REPO_ROOT, stdout=subprocess.PIPE,
                          stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace")
    lines = (proc.stdout or "").splitlines()
    exit_code = proc.returncode

    passed, failed, skipped = count_results(lines)
    for line in lines:
        m = _RESULT_RE.match(line)
        if m:
            tag = {"PASSED": "pass", "FAILED": "FAIL", "ERROR": "FAIL"}.get(m.group(2), "skip")
            print(f"  [{tag}] {m.group(1)}")

    if is_server_down("\n".join(lines), failed):
        ARTIFACT.write_text("", encoding="utf-8")
        print("\n  [environment] E2E skipped -- frontend or backend dev server is not reachable.")
        return exit_code

    ARTIFACT.write_text(build_artifact(lines, exit_code, failed), encoding="utf-8")

    total = passed + failed + skipped
    print(f"\nResults: {passed} passed, {failed} failed, {skipped} skipped ({total} total)")
    if exit_code != 0:
        print(f"Errors written to: {ARTIFACT}\n  E2E FAILED")
    else:
        print("  E2E PASSED")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
