"""Eval fixture — INTENTIONALLY BROKEN. Do not "fix" this in the real repo.

This logic bug is the broken state the /fix-tests skill is measured against. It is
checked out into a throwaway git worktree at eval time and repaired only there; the
real tree is never modified. It cannot leak into normal runs: pytest collects only
tests/ (pytest.ini testpaths), and ruff/mypy exclude evals/. A wrong arithmetic
operator is valid, well-typed Python, so no linter or type checker flags it either.
"""


def line_total(unit_price: int, quantity: int) -> int:
    # BUG: a line total is price TIMES quantity, not plus. The eval expects the
    # agent to change `+` to `*`.
    return unit_price + quantity
