/**
 * Seeds logs/test-failures.log with a `fixture 'db_session' not found` error — a
 * pattern that HAS a row in .claude/skills/fix-tests/known-fixes.md. This task
 * stresses the skill's known-fix short-circuit, so it's the one to use when
 * section-ablating the "Known-fix matching" section:
 *   node evals/section-ablate.cjs .claude/skills/fix-tests/SKILL.md "Known-fix matching"
 * With the section present the agent should consult known-fixes.md and one-shot the
 * fix (fewer reads/tokens); without it, it diagnoses from scratch.
 */
const { writeLog } = require('../../lib/fixture.cjs');

const LOG = `# source: scripts/run-tests.py
============================= test session starts =============================
collected 1 item

evals/fixtures/fix-tests-known/test_widget.py E                          [100%]

=================================== ERRORS ====================================
______________ ERROR at setup of test_widget_is_persisted _____________________
file evals/fixtures/fix-tests-known/test_widget.py, line 18
  async def test_widget_is_persisted() -> None:
E       fixture 'db_session' not found
>       available fixtures: anyio_backend, cache, capfd, capsys, monkeypatch, ...
>       use 'pytest --fixtures [testpath]' for help on them.

evals/fixtures/fix-tests-known/test_widget.py:18
=========================== short test summary info ===========================
ERROR evals/fixtures/fix-tests-known/test_widget.py::test_widget_is_persisted
============================ 1 error in 0.04s ================================
`;

module.exports = function setup(worktree) {
  writeLog(worktree, 'logs/test-failures.log', LOG);
};
