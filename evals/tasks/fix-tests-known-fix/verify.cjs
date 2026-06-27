/**
 * Passes when /fix-tests applied the documented `db_session` known-fix: the
 * `db_session` fixture is now a parameter of the test function signature. Content
 * check — no interpreter needed (the fixture references undefined names by design,
 * so it can't be executed; the repair is structural).
 */
const { fixtureMatches } = require('../../lib/fixture.cjs');

module.exports = function verify(worktree) {
  return fixtureMatches(worktree, 'evals/fixtures/fix-tests-known/test_widget.py', {
    // Signature must now take db_session (optionally typed): `(db_session)` or
    // `(db_session: AsyncSession)`. The bare `()` broken form must be gone.
    includes: [/def test_widget_is_persisted\(\s*db_session/],
    excludes: [/def test_widget_is_persisted\(\s*\)/],
  });
};
