/**
 * Seeds logs/pre-commit-errors.log for the fix-pre-commit eval, in the format the
 * git pre-commit hook / Pre-Commit: Run All Hooks task emits (a hook header ending
 * in `Failed`, then ruff `file:line:col: CODE message` lines). Points at the
 * committed fixture; /fix-pre-commit should fix the `== None` comparison.
 */
const { writeLog } = require('../../lib/fixture.cjs');

const LOG = `ruff.....................................................................Failed
- hook id: ruff
- exit code: 1

evals/fixtures/fix-pre-commit/checker.py:7:18: E711 [*] Comparison to \`None\` should be \`cond is None\`
Found 1 error.
`;

module.exports = function setup(worktree) {
  writeLog(worktree, 'logs/pre-commit-errors.log', LOG);
};
