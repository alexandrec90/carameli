/**
 * Passes when /fix-logs made extract_amount tolerate a missing key (returns 0)
 * while still returning the value when present. Runtime check — robust to however
 * the agent expresses the fix (.get, try/except, default).
 */
const { runPythonOk } = require('../../lib/fixture.cjs');

const CHECK =
  "import sys; sys.path.insert(0, 'evals/fixtures/fix-logs'); " +
  'from handler import extract_amount; ' +
  "raise SystemExit(0 if extract_amount({}) == 0 and extract_amount({'amount': 5}) == 5 else 1)";

module.exports = function verify(worktree) {
  return runPythonOk(worktree, CHECK);
};
