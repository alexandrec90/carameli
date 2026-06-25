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
from collections.abc import Callable
from pathlib import Path

import diagnostics
from script_common import venv_exe

REPO_ROOT = Path(__file__).resolve().parents[1]
ARTIFACT = REPO_ROOT / "logs" / "e2e-failures.log"
VITE_URL = "http://localhost:5173"
BACKEND_HEALTH = "http://127.0.0.1:8000/health"

_RESULT_RE = re.compile(r"^(tests[\\/].+?::\S+)\s+(PASSED|FAILED|SKIPPED|ERROR|XFAIL|XPASS)")


def reachable(url: str, timeout: int = 5) -> bool:
    try:
        urllib.request.urlopen(url, timeout=timeout)
        return True
    except OSError:
        return False


def get_unreachable_preflight_urls(
    check: Callable[[str, int], bool] = reachable,
) -> list[str]:
    """Return labeled pre-flight endpoints that are not reachable."""
    checks = [
        ("frontend dev server", VITE_URL, 3),
        ("backend health endpoint", BACKEND_HEALTH, 5),
    ]
    return [f"{label} ({url})" for label, url, timeout in checks if not check(url, timeout)]


def get_fix_hint(blob: str) -> str:
    """Infer a specific fix hint from a failure block's error text."""
    return diagnostics.get_e2e_fix_hint(blob)


def remove_diff_noise(block: list[str]) -> list[str]:
    """Strip pytest diff noise, keeping file:line context + the first assertion error."""
    return diagnostics.remove_e2e_diff_noise(block)


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
        and re.search(
            r"net::ERR_EMPTY_RESPONSE|net::ERR_CONNECTION_REFUSED|ECONNREFUSED|socket hang up",
            all_output,
        )
        is not None
        and re.search(r"AssertionError|assert |status[=\s]+[45]\d\d", all_output) is None
    )


def build_artifact(lines: list[str], exit_code: int, fail_count: int) -> str:
    """Build the structured failures artifact. Empty string means 'clear it'."""
    return diagnostics.build_e2e_artifact(lines, exit_code, fail_count)


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
    unreachable = get_unreachable_preflight_urls()
    if unreachable:
        ARTIFACT.write_text("", encoding="utf-8")
        print("  [environment] E2E skipped -- unreachable: " + "; ".join(unreachable) + ".")
        return 0

    if cross_browser:
        cmd = [
            "docker",
            "compose",
            "exec",
            "-T",
            "app",
            "pytest",
            "tests/e2e/",
            "--browser=chromium",
            "--browser=firefox",
            "--browser=webkit",
            "-v",
            "--tb=short",
        ]
        print("Running E2E tests...")
        code = subprocess.run(cmd, cwd=REPO_ROOT).returncode
        if code == 0:
            ARTIFACT.write_text("", encoding="utf-8")
        else:
            ARTIFACT.write_text(
                "# e2e-cross-browser\n"
                "# fix: inspect docker compose app logs and failing Playwright specs\n"
                + " ".join(cmd)
                + "\n",
                encoding="utf-8",
            )
        return code

    cmd = [
        str(venv_python),
        "-m",
        "pytest",
        "tests/e2e/",
        "-v",
        "--tb=short",
        "--no-header",
        "-p",
        "no:warnings",
    ]
    if headed:
        cmd.append("--headed")

    print("Running E2E tests...")
    proc = subprocess.run(
        cmd,
        cwd=REPO_ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
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
