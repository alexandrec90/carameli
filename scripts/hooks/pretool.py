#!/usr/bin/env python3
"""PreToolUse dispatcher (portable replacement for copilot-settings-pretool.ps1).

Order of operations:
  1. Enforce audit-design-flaws Step 2.5 batch caps (may block with exit 42).
  2. When the test-skill marker is active, write its frontmatter-hook artifact.
  3. When the fix-tests-auto marker is active, restart the app container on diff.

Marker selection is exposed as a pure function (`select_marker_scripts`) for unit
testing; see `scripts/hooks/tests/test_pretool.py`.
"""

import subprocess
import sys
from pathlib import Path

REPO_ROOT = (Path(__file__).parent / "../..").resolve()

ENFORCE_CAPS = REPO_ROOT / "scripts/hooks/enforce-audit-batch-caps.py"
TEST_SKILL_MARKER = REPO_ROOT / ".claude/skills/test-skill/.active"
TEST_SKILL_SCRIPT = REPO_ROOT / ".claude/skills/test-skill/write-artifacts.py"
FIX_TESTS_MARKER = REPO_ROOT / ".claude/skills/fix-tests-auto/.active"
FIX_TESTS_SCRIPT = REPO_ROOT / ".claude/skills/fix-tests-auto/restart-if-app-diff.py"


def select_marker_scripts(test_active: bool, fix_active: bool) -> list[list[str]]:
    """Return the argv lists for marker-gated steps, in execution order."""
    steps: list[list[str]] = []
    if test_active:
        steps.append([str(TEST_SKILL_SCRIPT), "--mode", "hook"])
    if fix_active:
        steps.append([str(FIX_TESTS_SCRIPT)])
    return steps


def main() -> int:
    raw = sys.stdin.read()

    # 1. Batch caps run before anything else and can block the tool call.
    if ENFORCE_CAPS.exists():
        result = subprocess.run([sys.executable, str(ENFORCE_CAPS)], input=raw, text=True)
        if result.returncode != 0:
            return result.returncode

    steps = select_marker_scripts(TEST_SKILL_MARKER.exists(), FIX_TESTS_MARKER.exists())
    for argv in steps:
        subprocess.run(
            [sys.executable, *argv],
            cwd=REPO_ROOT,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
