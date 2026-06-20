/**
 * Seeds the broken state for the fix-tests eval, run inside the worktree before
 * the agent starts. The /fix-tests skill diagnoses from logs/test-failures.log
 * (not a live pytest run), so we write a realistic pytest failure block pointing
 * at the committed broken fixture. The broken source itself is already present in
 * the worktree (committed under evals/fixtures/).
 */
const fs = require('node:fs');
const path = require('node:path');

const LOG = `============================= test session starts =============================
collected 1 item

evals/fixtures/fix-tests-logic-bug/test_calc.py F                        [100%]

================================== FAILURES ===================================
_____________________ test_line_total_multiplies ______________________________

    def test_line_total_multiplies() -> None:
>       assert line_total(5, 3) == 15
E       assert 8 == 15
E        +  where 8 = line_total(5, 3)

evals/fixtures/fix-tests-logic-bug/test_calc.py:5: AssertionError
=========================== short test summary info ===========================
FAILED evals/fixtures/fix-tests-logic-bug/test_calc.py::test_line_total_multiplies - assert 8 == 15
============================ 1 failed in 0.03s ===============================
`;

module.exports = function setup(worktree) {
  const logDir = path.join(worktree, 'logs'); // logs/ is gitignored, absent in a fresh worktree
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(path.join(logDir, 'test-failures.log'), LOG);
};
