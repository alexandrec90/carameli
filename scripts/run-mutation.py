#!/usr/bin/env python3
"""Runs mutmut mutation testing and writes the results to reports/mutation-report.txt.

Exits 0 even if mutants survive -- surviving mutants are informational, not a hard
failure, until the score target (>80%) is met.
"""

import subprocess
import sys

from script_common import REPO_ROOT, venv_exe


def main() -> int:
    (REPO_ROOT / "reports").mkdir(exist_ok=True)
    mutmut = str(venv_exe("mutmut"))

    run = subprocess.run([mutmut, "run"], cwd=REPO_ROOT)
    if run.returncode != 0:
        print(
            "mutmut run returned a non-zero status "
            "(expected while mutation score target is still in progress)."
        )

    results = subprocess.run(
        [mutmut, "results"],
        cwd=REPO_ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    output = results.stdout or ""
    print(output, end="")
    (REPO_ROOT / "reports" / "mutation-report.txt").write_text(output, encoding="utf-8")

    # Surviving mutants are informational; always succeed for now.
    return 0


if __name__ == "__main__":
    sys.exit(main())
