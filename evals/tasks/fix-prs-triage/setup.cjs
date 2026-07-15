/**
 * Seeds the broken state for the /fix-prs eval, run inside the worktree before the
 * agent starts.
 *
 * /fix-prs is a PR-lifecycle orchestrator (gh checkout → reproduce → fix → push →
 * merge). None of the gh/git/merge steps can run headless in a throwaway worktree
 * with no remote or PR — so this task exercises the ONE slice that is offline-
 * testable and is the skill's own documented degraded path (Step 0): when `gh` is
 * unreachable but a canonical failure artifact already exists in logs/, the skill
 * fixes the current checkout by delegating to the matching fixer (here /fix-tests).
 *
 * We write a realistic pytest failure block pointing at the committed broken fixture
 * under evals/fixtures/fix-prs/. Success = the skill recognises the degraded path,
 * routes the backend-test failure to /fix-tests, and the fixture bug gets repaired.
 */
const { writeLog } = require('../../lib/fixture.cjs');

const LOG = `# source: scripts/run-tests.py
============================= test session starts =============================
collected 1 item

evals/fixtures/fix-prs/test_discount.py F                                [100%]

================================== FAILURES ===================================
_______________________ test_discount_subtracts _______________________________

    def test_discount_subtracts() -> None:
>       assert discounted_price(100, 20) == 80
E       assert 120 == 80
E        +  where 120 = discounted_price(100, 20)

evals/fixtures/fix-prs/test_discount.py:5: AssertionError
=========================== short test summary info ===========================
FAILED evals/fixtures/fix-prs/test_discount.py::test_discount_subtracts - assert 120 == 80
============================ 1 failed in 0.03s ===============================
`;

module.exports = function setup(worktree) {
  writeLog(worktree, 'logs/test-failures.log', LOG);
};
