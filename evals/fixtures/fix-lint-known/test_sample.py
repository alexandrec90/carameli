"""Fixture for the fix-lint known-fix (S101) eval task. A bare assert in a test file
trips ruff S101 — a pattern with a documented row in fix-lint/known-fixes.md whose
fix adds a top-of-file ruff suppression directive. Excluded from real ruff/mypy;
leave it broken, it is the test data."""


def test_addition() -> None:
    assert 1 + 1 == 2
