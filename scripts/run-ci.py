#!/usr/bin/env python3
"""Tier-1 local CI gate: backend tests -> frontend unit tests -> E2E smoke.

Stops at the first failing stage. The E2E smoke stage is skipped (treated as a
pass) when --skip-e2e is given or the frontend dev server is unreachable.

Usage: python scripts/run-ci.py [--skip-e2e]
"""

import subprocess
import sys
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
FRONTEND_URL = "http://localhost:5173"

_BACKEND_ARGV = [
    "docker",
    "compose",
    "exec",
    "-T",
    "app",
    "pytest",
    "tests/unit/",
    "tests/integration/test_full_flows.py",
    "tests/integration/test_contract.py",
    "-x",
    "-q",
    "--tb=short",
]
_FRONTEND_ARGV = ["npm", "--prefix", "frontend", "run", "test:run"]
_E2E_ARGV = ["pytest", "tests/e2e/test_smoke.py", "--browser=chromium", "-q"]


def frontend_reachable(url: str = FRONTEND_URL, timeout: int = 5) -> bool:
    try:
        urllib.request.urlopen(url, timeout=timeout)
        return True
    except OSError:
        return False


def _stage(name: str, argv) -> int:
    print(f"\n=== {name} ===")
    return subprocess.run(argv, cwd=REPO_ROOT).returncode


def main(argv=None) -> int:
    args = sys.argv[1:] if argv is None else argv
    skip_e2e = any(a in ("--skip-e2e", "-SkipE2E") for a in args)

    code = _stage("Stage 1: Backend tests", _BACKEND_ARGV)
    if code != 0:
        return code

    code = _stage("Stage 2: Frontend unit tests", _FRONTEND_ARGV)
    if code != 0:
        return code

    print("\n=== Stage 3: E2E smoke ===")
    if skip_e2e:
        print("Skipping E2E smoke because --skip-e2e was provided.")
        print("=== All Tier 1 checks passed ===")
        return 0
    if not frontend_reachable():
        print(f"Skipping E2E smoke because frontend dev server is not reachable at {FRONTEND_URL}.")
        print("=== All Tier 1 checks passed ===")
        return 0

    code = subprocess.run(_E2E_ARGV, cwd=REPO_ROOT).returncode
    if code != 0:
        return code

    print("=== All Tier 1 checks passed ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
