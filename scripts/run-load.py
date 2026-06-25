#!/usr/bin/env python3
"""Runs a headless Locust load test and writes HTML + CSV reports to reports/.

Usage: python scripts/run-load.py [--users N] [--spawn-rate R] [--run-time T] [--host URL]
"""

import argparse
import subprocess
import sys

from script_common import REPO_ROOT, venv_exe


def build_argv(users: int, spawn_rate: str, run_time: str, host: str) -> list[str]:
    """Build the locust argv (reports go under reports/)."""
    return [
        str(venv_exe("locust")),
        "-f",
        "tests/load/locustfile.py",
        "--headless",
        "-u",
        str(users),
        "-r",
        spawn_rate,
        "--run-time",
        run_time,
        "--host",
        host,
        "--html",
        "reports/load-report.html",
        "--csv",
        "reports/load",
    ]


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--users", type=int, default=10)
    parser.add_argument("--spawn-rate", default="2")
    parser.add_argument("--run-time", default="1m")
    parser.add_argument("--host", default="http://localhost:8000")
    args = parser.parse_args(argv)

    (REPO_ROOT / "reports").mkdir(exist_ok=True)
    cmd = build_argv(args.users, args.spawn_rate, args.run_time, args.host)
    return subprocess.run(cmd, cwd=REPO_ROOT).returncode


if __name__ == "__main__":
    sys.exit(main())
