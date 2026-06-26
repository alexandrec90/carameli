/**
 * Confirms /optimize-fixers acted on the seeded recurring error (check 3g), run in
 * the worktree before teardown.
 *
 * The fixture is clean on 3a-3f, and success_rate 0.33 gates 3b off, so the only
 * legitimate edit is annotating the existing known-fixes.md row whose pattern matches
 * the recurring signature. The fixture skill is created by setup.cjs at run time
 * (untracked in the worktree), so git-diff semantics don't apply — instead we compare
 * the current known-fixes.md against the seeded original.
 *
 * Pass requires:
 *   1. The matching known-fixes row was annotated `(recurring — needs review)`, AND
 *   2. No brand-new naive row was added (the table keeps exactly one data row).
 */
const fs = require('node:fs');
const path = require('node:path');
const { KNOWN_FIXES, ORIGINAL_KNOWN_FIXES } = require('./setup.cjs');

// Count markdown table data rows (lines starting with `|` that are not the header
// or the `| --- |` separator).
function dataRowCount(content) {
  return content
    .split('\n')
    .filter((line) => line.trim().startsWith('|'))
    .filter((line) => !/Error pattern/i.test(line)) // header
    .filter((line) => !/^\s*\|\s*-{2,}/.test(line)) // separator
    .length;
}

module.exports = function verify(worktree) {
  let content = '';
  try {
    content = fs.readFileSync(path.join(worktree, KNOWN_FIXES), 'utf8');
  } catch {
    return false;
  }

  if (content === ORIGINAL_KNOWN_FIXES) return false; // no edit made

  // 1. The existing row gained the recurring annotation. Accept en-dash or hyphen.
  const annotated = /\(recurring\s*[—-]\s*needs review\)/i.test(content);

  // 2. No new naive row sneaked in — the table still has exactly one data row.
  const noNewRow = dataRowCount(content) === 1;

  return annotated && noNewRow;
};
