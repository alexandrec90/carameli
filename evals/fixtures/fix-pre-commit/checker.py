"""Fixture for the fix-pre-commit eval task. Carries an E711 violation (comparison
to None with ==). The fix is `value is None`. Excluded from real ruff/mypy; leave it
broken, it is the test data."""


def is_empty(value: object) -> bool:
    # BUG: E711 - comparison to None should use `is`
    return value == None
