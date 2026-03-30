"""Copilot session archive script.

Run via the "Agent: Archive Copilot Session" VS Code task, or called directly
by Copilot at the end of a significant work session. Captures git-based
activity and writes a compact summary JSON to logs/agent/.

Unlike the Claude Code version (archive-session.py) this script cannot parse
a conversation transcript (Copilot does not expose one). Instead it derives
work context from current git state: changed files, diff stats, and recent
commits.

Usage:
    python scripts/hooks/archive-session-copilot.py [description]
"""

import json
import os
import subprocess
import sys
from datetime import UTC, datetime

WORKSPACE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def run_git(*args):
    try:
        result = subprocess.run(  # noqa: S603
            ["git", *args],  # noqa: S607
            capture_output=True,
            text=True,
            cwd=WORKSPACE_ROOT,
        )
        return result.stdout.strip() if result.returncode == 0 else ""
    except OSError:
        return ""


def main():
    description = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else ""

    status_lines = run_git("status", "--short").splitlines()
    changed_files = [line[3:].strip() for line in status_lines if line.strip()]
    diff_stat = run_git("diff", "--stat", "HEAD")
    recent_log = run_git("log", "--oneline", "-10").splitlines()
    branch = run_git("rev-parse", "--abbrev-ref", "HEAD")

    summary = {
        "agent": "copilot",
        "timestamp": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "description": description,
        "branch": branch,
        "changed_files": changed_files,
        "changed_file_count": len(changed_files),
        "diff_stat": diff_stat,
        "recent_commits": recent_log,
    }

    agent_dir = os.path.join(WORKSPACE_ROOT, "logs", "agent")
    os.makedirs(agent_dir, exist_ok=True)

    date_str = datetime.now().strftime("%Y-%m-%d")
    time_str = datetime.now().strftime("%H%M%S")
    summary_path = os.path.join(agent_dir, f"{date_str}_copilot_{time_str}.json")

    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    sys.exit(0)


if __name__ == "__main__":
    main()
