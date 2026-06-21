/**
 * Seeds logs/pester-failures.log for the fix-pester eval, in the self-locating
 * format the Test: Run Pester task emits (`file:line:col: [Pester] suite.case --
 * message`). Points at the committed fixture; /fix-pester should correct the
 * returned literal.
 */
const { writeLog } = require('../../lib/fixture.cjs');

const LOG = `# pester
evals/fixtures/fix-pester/Sample.ps1:6:5: [Pester] Sample.Get-Greeting returns a greeting -- Expected 'Hello, World' but got 'Goodbye, World'
`;

module.exports = function setup(worktree) {
  writeLog(worktree, 'logs/pester-failures.log', LOG);
};
