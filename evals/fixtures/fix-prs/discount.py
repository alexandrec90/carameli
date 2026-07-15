"""Eval fixture — INTENTIONALLY BROKEN. Do not "fix" this in the real repo.

This logic bug is the broken state the /fix-prs skill is measured against in its
offline/degraded path: with no `gh` remote reachable in the throwaway worktree, the
skill should fall back to fixing whatever canonical artifact exists in logs/ (here a
seeded logs/test-failures.log) by delegating to /fix-tests. It is checked out into a
throwaway git worktree at eval time and repaired only there; the real tree is never
modified. pytest collects only tests/ (pytest.ini testpaths) and ruff/mypy exclude
evals/, so it can't leak into normal runs, and a wrong operator is valid, well-typed
Python that no linter flags.
"""


def discounted_price(price: int, percent: int) -> int:
    # BUG: a discount SUBTRACTS from the price. This adds the discount instead. The
    # eval expects the agent to change `+` to `-`.
    return price + (price * percent // 100)
