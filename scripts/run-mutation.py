#!/usr/bin/env python3
"""Runs mutmut mutation testing and writes the results to reports/mutation-report.txt.

Surviving mutants do not fail ``mutmut run`` -- they are the report. A non-zero
exit means the run itself broke (no stats, a failing clean test), so it is passed
through: reading it as "mutants survived" is how the weekly job stayed green for
months while mutating nothing.

mutmut 3 needs ``fork``, so this runs on Linux or WSL, not native Windows. One
worker, as in the weekly job: the selected tests share one database that each
session TRUNCATEs, so parallel workers fail each other's tests and inflate the
score. Configuration is ``setup.cfg``'s ``[mutmut]`` section.
"""

import subprocess
import sys

from script_common import REPO_ROOT, venv_exe


def main() -> int:
    (REPO_ROOT / "reports").mkdir(exist_ok=True)
    mutmut = str(venv_exe("mutmut"))

    run = subprocess.run([mutmut, "run", "--max-children", "1"], cwd=REPO_ROOT)
    if run.returncode != 0:
        print(f"mutmut run failed (exit {run.returncode}); the results below are incomplete.")

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

    return run.returncode


if __name__ == "__main__":
    sys.exit(main())
