"""Invariant: no scheduled workflow may collect a paid test.

`pytest.ini` sets `addopts = ... -m "not paid"`, which is the single guard that
keeps paid-tier tests (sandbox / chargeable / live_e2e) out of automated runs. But
that guard is only inherited when a pytest invocation does NOT override it: a
command-line `-m` REPLACES the addopts `-m` (last `-m` wins), and `-o addopts=`
wipes it entirely. So any scheduled job that passes its own `-m` (e.g. the weekly
migration job's `-m slow`) silently drops the paid exclusion unless it re-asserts it.

This test scans every *active* (uncommented `schedule:`) workflow and fails if any
pytest invocation could select a paid test — either by overriding `-m` without
re-adding `not paid`, or by wiping addopts without re-adding it. Stdlib only
(text parse), so it runs in the hook-tests step before the venv is guaranteed.
"""

import re

from conftest import REPO_ROOT

WORKFLOWS_DIR = REPO_ROOT / ".github" / "workflows"


def _uncommented_lines(text: str) -> list[str]:
    """Lines whose first non-space character is not '#'."""
    return [ln for ln in text.splitlines() if ln.strip() and not ln.lstrip().startswith("#")]


def _scheduled_workflow_files() -> list:
    """Workflow files with an active (uncommented) `schedule:` trigger."""
    scheduled = []
    for path in sorted(WORKFLOWS_DIR.glob("*.yml")):
        lines = _uncommented_lines(path.read_text(encoding="utf-8"))
        if any(re.match(r"\s*schedule:\s*$", ln) for ln in lines):
            scheduled.append(path)
    return scheduled


def _pytest_invocations(text: str) -> list[str]:
    """Every uncommented line that invokes pytest, from `pytest` onward."""
    invocations = []
    for ln in _uncommented_lines(text):
        m = re.search(r"\bpytest\b.*", ln)
        if m:
            invocations.append(m.group(0))
    return invocations


def _is_paid_safe(cmd: str) -> bool:
    """A pytest command is paid-safe iff it cannot collect a `paid`-marked test.

    Safe when it neither overrides the marker selection nor wipes addopts (it then
    inherits pytest.ini's `-m "not paid"`); if it does either, it must itself carry
    `not paid`.
    """
    overrides_markers = re.search(r"(^|\s)-m(\s|=)", cmd) is not None
    wipes_addopts = re.search(r"-o\s+['\"]?addopts=", cmd) is not None
    if overrides_markers or wipes_addopts:
        return "not paid" in cmd
    return True


def test_scheduled_workflows_exist():
    # Guard against the scan silently matching nothing (e.g. a rename) and the
    # invariant below passing vacuously.
    names = {p.name for p in _scheduled_workflow_files()}
    assert {"nightly.yml", "weekly.yml"} <= names, f"expected scheduled workflows, found {names}"


def test_no_scheduled_pytest_invocation_can_collect_paid():
    checked = 0
    for path in _scheduled_workflow_files():
        for cmd in _pytest_invocations(path.read_text(encoding="utf-8")):
            checked += 1
            assert _is_paid_safe(cmd), (
                f"{path.name}: pytest invocation may collect a paid test -- it overrides "
                f'-m / addopts without re-asserting `not paid`:\n  {cmd}\n'
                'Add `not paid` to its -m selection (e.g. -m "slow and not paid").'
            )
    # Sanity: the scan actually reached the pytest steps it is meant to protect.
    assert checked >= 3, f"expected to check several pytest invocations, checked {checked}"


def test_helper_flags_bare_dash_m_slow_as_unsafe():
    # The exact regression this guard exists for: a bare `-m slow` drops `not paid`.
    assert _is_paid_safe('pytest tests/unit/test_migration_concerns.py -m slow') is False
    assert _is_paid_safe('pytest tests/unit/test_migration_concerns.py -m "slow and not paid"') is True
    # No override -> inherits the addopts default -> safe.
    assert _is_paid_safe("pytest tests/integration/test_resilience.py -v") is True
    # Wiping addopts without re-adding the exclusion is unsafe.
    assert _is_paid_safe("pytest tests/live_e2e -o addopts= -m live_e2e") is False
