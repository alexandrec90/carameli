/**
 * Seeds logs/test-failures.log with a LOW-QUALITY block: the failure's traceback
 * was filtered out, leaving the `[raw fallback: no E-lines in filtered output]`
 * marker, no `E` lines, and no app/ or tests/ frame. The root cause is invisible
 * from the log, which is exactly the signal the fix-tests "Log quality gate"
 * section says must be repaired at the FILTER (scripts/diagnostics.py) — not by
 * guess-fixing source.
 *
 * This is the task to use when section-ablating that gate:
 *   node evals/section-ablate.cjs .claude/skills/fix-tests/SKILL.md "Log quality gate"
 * With the section present, the agent should widen the filter; without it, it tends
 * to flail at the fixture it can't actually diagnose.
 */
const { writeLog } = require('../../lib/fixture.cjs');

const LOG = `# source: scripts/run-tests.py
============================= test session starts =============================
collected 1 item

evals/fixtures/fix-tests-lowqual/test_inventory.py F                      [100%]

================================== FAILURES ===================================
________________ test_inventory_reorder_threshold _____________________________
  [raw fallback: no E-lines in filtered output]

=========================== short test summary info ===========================
FAILED evals/fixtures/fix-tests-lowqual/test_inventory.py::test_inventory_reorder_threshold
============================ 1 failed in 0.05s ================================
`;

module.exports = function setup(worktree) {
  writeLog(worktree, 'logs/test-failures.log', LOG);
};
