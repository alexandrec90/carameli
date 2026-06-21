"""Fixture for the fix-logs eval task. extract_amount raises KeyError when the
key is absent — the bug surfaced in the seeded runtime log. The correct fix
defaults the missing key to 0. Excluded from real ruff/mypy/pytest; the breakage
is the test data, leave it broken here."""
import logging

logger = logging.getLogger(__name__)


def extract_amount(payload: dict) -> int:
    # BUG: KeyError when 'amount' is missing; should default to 0
    return payload["amount"]
