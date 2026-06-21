/**
 * Seeds logs/log-errors.log for the fix-logs eval, in the exact pipe format the
 * Log: Extract Errors task emits:
 *   YYYY-MM-DD HH:MM:SS.mmm | LEVEL | module.path:lineno | message
 * The module path maps to the committed fixture file; /fix-logs should make
 * extract_amount tolerate a missing key.
 */
const { writeLog } = require('../../lib/fixture.cjs');

const LOG = `2026-06-20 10:15:03.221 | ERROR    | evals.fixtures.fix-logs.handler:11 | KeyError: 'amount' raised in extract_amount (evals/fixtures/fix-logs/handler.py) when the payload omits the key
`;

module.exports = function setup(worktree) {
  writeLog(worktree, 'logs/log-errors.log', LOG);
};
