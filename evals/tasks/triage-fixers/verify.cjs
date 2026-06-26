/**
 * Confirms /triage-fixers produced a correct ranked triage report, run in the
 * worktree before teardown.
 *
 * Pass requires all three:
 *   1. logs/agent/triage-report.md exists.
 *   2. The high-priority skill (fix-eval-high) is named ABOVE the low-priority one
 *      (fix-eval-low) — i.e. it appears first in the report text.
 *   3. The report cites at least one of the seeded recurring signatures verbatim.
 */
const fs = require('node:fs');
const path = require('node:path');
const { REPORT, HIGH, LOW, RECURRING_SIGS } = require('./setup.cjs');

module.exports = function verify(worktree) {
  let report = '';
  try {
    report = fs.readFileSync(path.join(worktree, REPORT), 'utf8');
  } catch {
    return false; // 1. report not written
  }

  const iHigh = report.indexOf(HIGH);
  const iLow = report.indexOf(LOW);

  // 2. high must be present and ranked above low. If low is absent entirely
  // (omitted as an all-zero candidate), that's still "high above low".
  if (iHigh === -1) return false;
  const highAboveLow = iLow === -1 || iHigh < iLow;
  if (!highAboveLow) return false;

  // 3. at least one seeded recurring signature is cited verbatim.
  const citesRecurring = RECURRING_SIGS.some((sig) => report.includes(sig));

  return citesRecurring;
};
