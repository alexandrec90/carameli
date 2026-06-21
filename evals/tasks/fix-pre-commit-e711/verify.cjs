/**
 * Passes when /fix-pre-commit replaced the `== None` comparison with `is None`.
 * Content check.
 */
const { fixtureMatches } = require('../../lib/fixture.cjs');

module.exports = function verify(worktree) {
  return fixtureMatches(worktree, 'evals/fixtures/fix-pre-commit/checker.py', {
    includes: [/value is None/],
    excludes: [/==\s*None/],
  });
};
