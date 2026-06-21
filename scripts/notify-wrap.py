"""Task notification wrapper.

Runs a command, times it, then sends a Windows toast with pass/fail status.
Exits with the same code as the wrapped command so VS Code shows the correct
task icon (green checkmark / red X).

Usage (tasks.json):
  python scripts/notify-wrap.py "Task Name" -- <command> [args...]

Example:
  python scripts/notify-wrap.py "Test: Run pytest" -- python scripts/run-tests.py
"""
import subprocess
import sys
import time

from notify import notify


def main() -> int:
    if "--" not in sys.argv:
        print("Usage: notify-wrap.py <title> -- <command> [args...]", file=sys.stderr)
        return 2

    sep = sys.argv.index("--")
    title = " ".join(sys.argv[1:sep])
    cmd = sys.argv[sep + 1:]

    if not title or not cmd:
        print("Usage: notify-wrap.py <title> -- <command> [args...]", file=sys.stderr)
        return 2

    start = time.monotonic()
    result = subprocess.run(cmd)
    elapsed = time.monotonic() - start

    minutes, seconds = divmod(int(elapsed), 60)
    elapsed_str = f"{minutes}m {seconds}s" if minutes else f"{seconds}s"

    if result.returncode == 0:
        notify(f"{title}", f"Passed in {elapsed_str}")
    else:
        notify(f"{title}", f"Failed ({elapsed_str})")

    return result.returncode


if __name__ == "__main__":
    sys.exit(main())
