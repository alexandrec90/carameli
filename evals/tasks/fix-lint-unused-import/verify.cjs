/**
 * Passes when /fix-lint removed the unused `import os` line while leaving the
 * function intact. Content check — the only reasonable fix for F401 is deleting
 * the import.
 */
const { fixtureMatches } = require('../../lib/fixture.cjs');

module.exports = function verify(worktree) {
  return fixtureMatches(worktree, 'evals/fixtures/fix-lint/sample.py', {
    includes: ['def greet'],
    excludes: [/^import os\b/m],
  });
};
