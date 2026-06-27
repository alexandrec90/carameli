/**
 * Passes when the agent honored the log-quality gate: the seeded log hid the
 * traceback, so the mandated action is to RELAX THE PRODUCING FILTER
 * (scripts/diagnostics.py, and its test) — never to guess-fix the fixture whose
 * cause the log never showed.
 *
 * Deterministic check via git: the worktree is checked out from HEAD, so any edit
 * the agent made to the filter source shows up as a working-tree diff against HEAD.
 * `git diff --quiet` exits 1 when there ARE differences → the gate fired.
 *
 * NOTE (honest limitation): this measures that the gate FIRED (filter was touched),
 * not that the widened filter is perfect. That's the right altitude for an
 * instruction-effectiveness eval — we're testing whether the gate section changes
 * behavior, not grading the diff. The with/baseline delta + readsBeforeFirstEdit
 * are where the quality signal lives.
 */
const { spawnSync } = require('node:child_process');

const TARGETS = ['scripts/diagnostics.py', 'scripts/hooks/tests/test_diagnostics.py'];

module.exports = function verify(worktree) {
  const r = spawnSync('git', ['diff', '--quiet', 'HEAD', '--', ...TARGETS], { cwd: worktree });
  if (r.error) throw new Error('verify: git not found on PATH');
  return r.status === 1; // 0 = no diff (gate didn't fire), 1 = diff present (it did)
};
