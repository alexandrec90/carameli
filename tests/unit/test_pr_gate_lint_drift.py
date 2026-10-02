"""The PR gate's lint job fails when `scripts/lint-all.py` rewrote a tracked file.

`lint-all.py` auto-fixes (ruff --fix, ruff format, eslint, stylelint, markdownlint)
and then re-checks the tree it just fixed, so its own exit code never reports drift:
the `git diff` after it is the only thing that does. That step used to warn and pass,
on the grounds that the lint-fix PostToolUse hook applied the fixes on every edit. No
agent hook runs any more, so the warning let an unformatted
`tests/unit/test_gitignore_contract.py` merge to master, and the next full local run
rewrote it inside a fixer's branch that never touched it.
"""

from __future__ import annotations

from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
PR_GATE = REPO_ROOT / ".github" / "workflows" / "pr-gate.yml"


def lint_steps() -> list[dict]:
    workflow = yaml.safe_load(PR_GATE.read_text(encoding="utf-8"))
    return workflow["jobs"]["lint"]["steps"]


def drift_step() -> dict:
    steps = lint_steps()
    lint_at = next(i for i, s in enumerate(steps) if "scripts/lint-all.py" in s.get("run", ""))
    found = [s for s in steps[lint_at + 1 :] if "git diff --quiet" in s.get("run", "")]
    assert len(found) == 1, "the lint job needs one `git diff --quiet` step after lint-all.py"
    return found[0]


def test_drift_after_lint_all_fails_the_job() -> None:
    step = drift_step()
    assert "exit 1" in step["run"], f"{step['name']!r} reports drift without failing on it"
    assert not step.get("continue-on-error"), f"{step['name']!r} must not continue on error"


def test_drift_step_does_not_call_itself_non_blocking() -> None:
    step = drift_step()
    assert "non-blocking" not in step["name"] + step["run"]
