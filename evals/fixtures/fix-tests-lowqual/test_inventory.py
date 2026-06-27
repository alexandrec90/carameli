"""Fixture for the fix-tests log-quality-gate eval task.

The seeded logs/test-failures.log for this test has had its traceback stripped —
it carries the `[raw fallback: no E-lines in filtered output]` marker, with no `E`
lines and no app/ or tests/ frame — so the root cause is INVISIBLE from the log
alone. The skill's mandatory log-quality gate should fire: the agent must improve
the producing filter in scripts/diagnostics.py (and its test) rather than
guess-fixing source against a log where the cause can't be seen.

Excluded from real pytest/ruff/mypy (pytest collects only tests/; ruff/mypy
exclude evals/). Leave it as-is — it is the test data, and the correct response to
this task does NOT touch this file.
"""


def test_inventory_reorder_threshold() -> None:
    assert reorder_point(stock=2, daily_use=5) <= 0  # noqa: F821
