/**
 * Passes when /fix-docker corrected the env key typo. Content check on the
 * distinctive key name.
 */
const { fixtureMatches } = require('../../lib/fixture.cjs');

module.exports = function verify(worktree) {
  return fixtureMatches(worktree, 'evals/fixtures/fix-docker/service.fixture.yml', {
    includes: ['DATABASE_URL'],
    excludes: ['DATABSE_URL'],
  });
};
