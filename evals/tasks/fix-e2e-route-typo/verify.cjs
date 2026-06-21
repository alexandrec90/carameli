/**
 * Passes when /fix-e2e corrected the dashboard route typo. Content check on the
 * distinctive path token.
 */
const { fixtureMatches } = require('../../lib/fixture.cjs');

module.exports = function verify(worktree) {
  return fixtureMatches(worktree, 'evals/fixtures/fix-e2e/routes.ts', {
    includes: ['"/dashboard"'],
    excludes: ['dahsboard'],
  });
};
