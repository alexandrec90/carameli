/**
 * Passes when /fix-lint applied the documented S101 known-fix: a
 * `# ruff: noqa: S101` directive added to the file. Content check.
 */
const { fixtureMatches } = require('../../lib/fixture.cjs');

module.exports = function verify(worktree) {
  return fixtureMatches(worktree, 'evals/fixtures/fix-lint-known/test_sample.py', {
    includes: [/#\s*ruff:\s*noqa:\s*S101/],
  });
};
