/**
 * Seeds logs/e2e-failures.log for the fix-e2e eval, in the structured format the
 * Test: Run E2E task emits (`# test_name[browser]` + `# fix:` hint + error lines).
 * The error line names the committed fixture explicitly so the agent edits it
 * rather than the real frontend/src/routes.ts. /fix-e2e should correct the typo.
 */
const { writeLog } = require('../../lib/fixture.cjs');

const LOG = `# dashboard_loads[chromium]
# fix: navigation -- the route table named in the assertion below has a typo
Error: expected to navigate to "/dashboard" but evals/fixtures/fix-e2e/routes.ts defines "/dahsboard"
  at tests/e2e/dashboard.spec.ts:12
`;

module.exports = function setup(worktree) {
  writeLog(worktree, 'logs/e2e-failures.log', LOG);
};
