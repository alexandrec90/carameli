/**
 * Shared with-vs-other delta logic for the eval scripts.
 *
 * Both summarize.cjs (full vs stripped baseline) and ablate.cjs (full vs
 * leave-one-out) produce the same shape of comparison: the `with-instructions`
 * arm against whatever the other arm is. This module loads a promptfoo results
 * JSON and prints the per-task delta. The "other" arm is simply any provider whose
 * label is not `with-instructions`, so it works for `baseline-*` and `ablate-*`
 * alike.
 *
 * Variance-aware: `promptfoo eval --repeat N` (npm run eval:stable) emits N rows
 * per (task, provider). Agent runs are stochastic, so a single row is a point
 * estimate that invites chasing noise. We aggregate all rows for an arm into a
 * median + observed range, and when the two arms' tool-call ranges OVERLAP we call
 * the delta inconclusive — the instruction file neither clearly helped nor hurt at
 * this sample size. A single-run comparison still prints, flagged provisional.
 */
const fs = require('node:fs');

// Lower-is-better metrics (verifyPassed handled separately).
const NUMERIC = [
  ['toolCalls', 'tool calls'],
  ['failedToolCalls', 'failed calls'],
  ['readsBeforeFirstEdit', 'reads before edit'],
];

function taskLabel(entry) {
  const p = entry?.vars?.prompt ?? entry?.prompt?.raw ?? '(unknown)';
  return String(p).replace(/\s+/g, ' ').trim().slice(0, 70);
}

const median = (nums) => {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// Pull a numeric metric (defined only) across an arm's rows. `pick` reads one row.
const vals = (rows, pick) => rows.map(pick).filter((v) => v != null && !Number.isNaN(v));

// Inclusive ranges [aMin,aMax] and [bMin,bMax] overlap?
const rangesOverlap = (a, b) => a[0] <= b[1] && b[0] <= a[1];

function arrow(withVal, otherVal) {
  if (withVal == null || otherVal == null) return '';
  const d = withVal - otherVal;
  if (d === 0) return '=';
  return d < 0 ? `down ${-d} (better)` : `up ${d} (worse)`;
}

// "med [min-max]" when there's spread, "med" when a single run (or no variance).
function fmtStat(nums, width = 3) {
  const m = median(nums);
  if (m == null) return String('-').padStart(width);
  const lo = Math.min(...nums);
  const hi = Math.max(...nums);
  const med = (Number.isInteger(m) ? String(m) : m.toFixed(1)).padStart(width);
  return lo === hi ? med : `${med} [${lo}-${hi}]`;
}

// group rows -> Map task -> { with: [rows], other: [rows] }. With --repeat N each
// (task, arm) contributes N rows; a default run contributes 1.
function groupByTask(data) {
  const rows = data?.results?.results ?? [];
  const byTask = new Map();
  for (const r of rows) {
    const key = taskLabel(r);
    const bucket = byTask.get(key) ?? { with: [], other: [] };
    // Any `with-instructions*` label is the full-instruction arm — this covers the
    // capable tier (`with-instructions-capable`) too, so a Sonnet task's rows don't
    // both fall into `other` and leave the comparison with no baseline to diff.
    if (String(r?.provider?.label ?? '').startsWith('with-instructions')) bucket.with.push(r);
    else bucket.other.push(r); // baseline-* or ablate-*
    byTask.set(key, bucket);
  }
  return byTask;
}

/**
 * Print the per-task delta. `otherName` labels the comparison arm in the header
 * (e.g. "baseline" or "ablate .claude/rules/voip-providers.md").
 */
function printDelta(data, { otherName = 'other' } = {}) {
  const byTask = groupByTask(data);
  const evalId = data?.evalId ?? '(no id)';
  console.log(`\n===== with-instructions vs ${otherName}  (${evalId}) =====`);
  console.log('"better" = the full instruction set helped on this task.');
  console.log('Stats are median [min-max] across repeats; single-run rows are provisional.\n');

  for (const [task, { with: wRows, other: oRows }] of byTask) {
    const n = Math.max(wRows.length, oRows.length);
    const provisional = n <= 1;
    console.log(`Task: ${task}${n > 1 ? `  (n=${n} repeats)` : ''}`);

    const wPass = wRows.filter((r) => r.success).length;
    const oPass = oRows.filter((r) => r.success).length;
    if (wRows.length) console.log(`  with-instructions: ${wPass}/${wRows.length} PASS  score=${(median(vals(wRows, (r) => r.score)) ?? 0).toFixed(2)}  cost=$${(median(vals(wRows, (r) => r.cost)) ?? 0).toFixed(4)}`);
    if (oRows.length) console.log(`  ${otherName}: ${oPass}/${oRows.length} PASS  score=${(median(vals(oRows, (r) => r.score)) ?? 0).toFixed(2)}  cost=$${(median(vals(oRows, (r) => r.cost)) ?? 0).toFixed(4)}`);

    if (wRows.length && oRows.length) {
      for (const [field, label] of NUMERIC) {
        const wv = vals(wRows, (r) => r.metadata?.[field]);
        const ov = vals(oRows, (r) => r.metadata?.[field]);
        if (!wv.length && !ov.length) continue;
        const a = arrow(median(wv), median(ov));
        console.log(`    ${label.padEnd(20)} with=${fmtStat(wv)}  other=${fmtStat(ov)}   ${a}`);
      }

      const wVerify = vals(wRows, (r) => (r.metadata?.verifyPassed == null ? null : r.metadata.verifyPassed ? 1 : 0));
      const oVerify = vals(oRows, (r) => (r.metadata?.verifyPassed == null ? null : r.metadata.verifyPassed ? 1 : 0));
      if (wVerify.length || oVerify.length) {
        const frac = (arr, rows) => (arr.length ? `${arr.filter(Boolean).length}/${rows.length}` : '-');
        console.log(`    ${'verified fix'.padEnd(20)} with=${String(frac(wVerify, wRows)).padStart(3)}  other=${String(frac(oVerify, oRows)).padStart(3)}`);
      }

      // The three optimization axes: accuracy is gated above; tokens, latency, and
      // cost are reported here so you can minimize them among variants that pass.
      const wTok = vals(wRows, (r) => r.tokenUsage?.total);
      const oTok = vals(oRows, (r) => r.tokenUsage?.total);
      if (wTok.length || oTok.length) {
        console.log(`    ${'tokens'.padEnd(20)} with=${fmtStat(wTok, 6)}  other=${fmtStat(oTok, 6)}   ${arrow(median(wTok), median(oTok))}`);
      }
      const wMs = vals(wRows, (r) => r.latencyMs);
      const oMs = vals(oRows, (r) => r.latencyMs);
      if (wMs.length || oMs.length) {
        console.log(`    ${'latency ms'.padEnd(20)} with=${fmtStat(wMs, 6)}  other=${fmtStat(oMs, 6)}   ${arrow(median(wMs), median(oMs))}`);
      }
      const costDelta = (median(vals(wRows, (r) => r.cost)) ?? 0) - (median(vals(oRows, (r) => r.cost)) ?? 0);
      console.log(`    ${'cost'.padEnd(20)} delta=$${costDelta.toFixed(4)} (median)`);

      // Verdict, on medians — with a noise guard so fix-instructions can't chase jitter.
      const wTc = vals(wRows, (r) => r.metadata?.toolCalls);
      const oTc = vals(oRows, (r) => r.metadata?.toolCalls);
      const otherDegenerate = (median(oTc) ?? 0) === 0 && oPass === 0;
      if (otherDegenerate) {
        console.log('    => comparison arm did no real work (likely an unresolved /skill).');
        console.log('       Add a `baselinePrompt` to the task before trusting this row.');
      } else if (wTc.length && oTc.length) {
        const wRange = [Math.min(...wTc), Math.max(...wTc)];
        const oRange = [Math.min(...oTc), Math.max(...oTc)];
        const overlap = !provisional && rangesOverlap(wRange, oRange);
        const medW = median(wTc);
        const medO = median(oTc);
        if (overlap) {
          console.log('    => INCONCLUSIVE: tool-call ranges overlap — the delta is within run-to-run');
          console.log('       noise at this sample size. Do not edit instructions off this row; add repeats.');
        } else if (medW < medO && (wPass > 0 || oPass === 0)) {
          console.log(`    => the full instruction set earned its tokens here.${provisional ? ' (provisional — single run; confirm with npm run eval:stable)' : ''}`);
        } else if (medW >= medO && wPass === oPass) {
          console.log(`    => no behavioral gain — pruning candidate for the file this task targets.${provisional ? ' (provisional — single run; confirm with npm run eval:stable)' : ''}`);
        }
      }
    } else {
      console.log('    (only one arm produced a result — check provider errors above)');
    }
    console.log('');
  }

  const stats = data?.results?.stats ?? {};
  console.log(`Totals: ${stats.successes ?? '?'} pass / ${stats.failures ?? '?'} fail / ${stats.errors ?? '?'} error`);
}

function load(outPath) {
  if (!fs.existsSync(outPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(outPath, 'utf8'));
  } catch {
    return null;
  }
}

module.exports = { groupByTask, printDelta, load, taskLabel, median, rangesOverlap };
