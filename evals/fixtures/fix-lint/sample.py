"""Fixture for the fix-lint eval task. Carries one deliberate lint violation
(F401 unused import). Excluded from real ruff/mypy via ruff.toml / mypy.ini, so it
never affects normal lint runs. Do not "fix" it here — the breakage is the test data."""
import os


def greet(name: str) -> str:
    return f"hello {name}"
