/**
 * Passes when /fix-pester changed Get-Greeting to return a greeting instead of a
 * farewell. Content check on the distinctive literal.
 */
const { fixtureMatches } = require('../../lib/fixture.cjs');

module.exports = function verify(worktree) {
  return fixtureMatches(worktree, 'evals/fixtures/fix-pester/Sample.ps1', {
    includes: [/Hello, \$Name/],
    excludes: [/Goodbye/],
  });
};
