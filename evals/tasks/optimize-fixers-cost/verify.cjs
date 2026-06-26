/**
 * Confirms /optimize-fixers acted on the seeded token-cost regression (check 3f),
 * run in the worktree before teardown.
 *
 * The fixture is clean on 3a-3e, so the only legitimate edit is one that closes the
 * fixture skill's context/output-discipline gap. The fixture skill is created by
 * setup.cjs at run time (untracked in the worktree), so git-diff semantics don't
 * apply — instead we compare the current SKILL.md against the seeded original.
 *
 * Pass requires:
 *   1. The fixture SKILL.md content changed from the seed, AND
 *   2. The change adds context/output-discipline language it previously lacked (or
 *      removes the dump-everything instruction) — tying the edit to 3f rather than
 *      an incidental change.
 */
const fs = require('node:fs');
const path = require('node:path');
const { SKILL_MD, ORIGINAL_SKILL_MD } = require('./setup.cjs');

// Discipline wording a 3f remedy should introduce. The fixture SKILL.md starts with
// NONE of these (it tells the agent to re-run the full suite and paste output).
const DISCIPLINE = [
  /log artifact/i,
  /single (targeted )?verification/i,
  /(don'?t|do not|never)\b[^.]*\b(re-?run|paste|dump|full (test )?output|full suite)/i,
  /head\+?tail|head and tail/i,
  /\bcap(ped|ping)?\b[^.]*\boutput/i,
  /context (window|budget|bloat|discipline)/i,
];

module.exports = function verify(worktree) {
  let content = '';
  try {
    content = fs.readFileSync(path.join(worktree, SKILL_MD), 'utf8');
  } catch {
    return false;
  }

  if (content === ORIGINAL_SKILL_MD) return false; // no edit made

  const addedDiscipline = DISCIPLINE.some((re) => re.test(content));
  const removedDumpAll = !/paste the complete output/i.test(content);

  return addedDiscipline || removedDumpAll;
};
