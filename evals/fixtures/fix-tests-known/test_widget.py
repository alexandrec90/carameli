"""Fixture for the fix-tests known-fix eval task. The test references the
`db_session` fixture but omits it from its signature, so pytest reports
`fixture 'db_session' not found` — a pattern with a documented row in
.claude/skills/fix-tests/known-fixes.md (fix: add the `db_session` parameter to
the test signature).

This stresses the skill's known-fix short-circuit: the agent should consult
known-fixes.md and one-shot the fix instead of diagnosing from scratch.

Excluded from real pytest/ruff/mypy (pytest collects only tests/; ruff/mypy
exclude evals/). Leave it broken — it is the test data.
"""

import pytest


@pytest.mark.asyncio
async def test_widget_is_persisted() -> None:
    widget = await create_widget(db_session, name="alpha")  # noqa: F821
    assert widget.id is not None
