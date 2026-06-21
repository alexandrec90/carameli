/**
 * Seeds logs/lint-errors.log for the fix-lint eval, in the format the Lint:
 * Everything task produces (`# toolname` section + `file:line:col: CODE message`).
 * Points at the committed broken fixture; /fix-lint should remove the unused import.
 */
const { writeLog } = require('../../lib/fixture.cjs');

const LOG = `# ruff
evals/fixtures/fix-lint/sample.py:4:8: F401 [*] \`os\` imported but unused
`;

module.exports = function setup(worktree) {
  writeLog(worktree, 'logs/lint-errors.log', LOG);
};
