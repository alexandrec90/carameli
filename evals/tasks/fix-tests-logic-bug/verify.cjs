/**
 * Confirms the agent actually repaired the bug, run in the worktree before
 * teardown. Executes the (possibly fixed) fixture with a real interpreter — no
 * pytest/venv needed, since the fixture has no dependencies. Returns true only
 * if line_total now multiplies (5 * 3 == 15).
 */
const { spawnSync } = require('node:child_process');

const CHECK =
  "import sys; sys.path.insert(0, 'evals/fixtures/fix-tests-logic-bug'); " +
  'from calc import line_total; ' +
  'raise SystemExit(0 if line_total(5, 3) == 15 else 1)';

module.exports = function verify(worktree) {
  // shell:false so the -c string isn't re-parsed/mangled; try the py launcher too.
  for (const [cmd, args] of [['python', ['-c', CHECK]], ['py', ['-3', '-c', CHECK]]]) {
    const r = spawnSync(cmd, args, { cwd: worktree });
    if (r.error) continue; // interpreter not on PATH — try the next
    return r.status === 0;
  }
  throw new Error('verify: no python interpreter found on PATH');
};
