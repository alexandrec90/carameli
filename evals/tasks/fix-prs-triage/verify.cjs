/**
 * Confirms /fix-prs (via its degraded path → /fix-tests delegation) actually
 * repaired the bug. Executes the possibly-fixed fixture with a real interpreter —
 * no pytest/venv needed, since the fixture has no dependencies. Returns true only
 * if a discount now subtracts (100 - 20% == 80).
 */
const { runPythonOk } = require('../../lib/fixture.cjs');

const CHECK =
  "import sys; sys.path.insert(0, 'evals/fixtures/fix-prs'); " +
  'from discount import discounted_price; ' +
  'raise SystemExit(0 if discounted_price(100, 20) == 80 else 1)';

module.exports = function verify(worktree) {
  return runPythonOk(worktree, CHECK);
};
