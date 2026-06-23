/**
 * Confirms the agent actually acted on the seeded eval results, run in the worktree
 * before teardown. Two deterministic checks for the fix-instructions core loop:
 *
 *   1. It STAMPED the run: state.json.lastAddressedEvalId === the seeded evalId.
 *   2. It made a REAL instruction edit — a change under .claude/ or to CLAUDE.md
 *      that is NOT just the skill's own bookkeeping (state.json / known-fixes.md).
 *
 * The 3d refusal (not editing off the degenerate-baseline task) is exercised by the
 * seeded artifact but not gated here — asserting a non-edit by content is brittle;
 * tighten it when this task is run locally and the transcript is available.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { EVAL_ID } = require('./setup.cjs');

const SKILL_DIR = '.claude/skills/fix-instructions';

// Parsed porcelain paths (handles rename "old -> new" by taking the destination).
function changedPaths(worktree) {
  const r = spawnSync('git', ['status', '--porcelain', '--', '.claude', 'CLAUDE.md'], {
    cwd: worktree, encoding: 'utf8',
  });
  if (r.status !== 0) return [];
  return r.stdout
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => {
      const body = l.slice(3);
      const arrow = body.indexOf(' -> ');
      return (arrow >= 0 ? body.slice(arrow + 4) : body).trim().split('\\').join('/');
    });
}

module.exports = function verify(worktree) {
  // 1. Run stamped with the seeded evalId.
  let stamped = false;
  try {
    const state = JSON.parse(
      fs.readFileSync(path.join(worktree, SKILL_DIR, 'state.json'), 'utf8'),
    );
    stamped = state.lastAddressedEvalId === EVAL_ID;
  } catch {
    stamped = false;
  }

  // 2. A real instruction edit outside the skill's own bookkeeping files.
  const madeInstructionEdit = changedPaths(worktree).some(
    (p) => !p.startsWith(SKILL_DIR),
  );

  return stamped && madeInstructionEdit;
};
