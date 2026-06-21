/**
 * Reads evals/output/latest.json and prints the with-instructions vs stripped
 * baseline delta per task. promptfoo's own table grades each provider in isolation;
 * the thing you care about — "did the instruction files change behavior, by how
 * much" — is the gap between the two columns. This surfaces it.
 *
 * Best-effort by design: never throws, always exits 0, so it can be chained after
 * `promptfoo eval` (which exits non-zero when tasks fail) without masking the
 * eval's result. Run via `npm run eval:summary`.
 */
const path = require('node:path');
const { load, printDelta } = require('./lib/compare.cjs');

const OUT = path.resolve(__dirname, 'output', 'latest.json');

try {
  const data = load(OUT);
  if (!data) {
    console.log(`\n[eval:summary] No readable results at ${OUT}. Run \`npm run eval\` first.\n`);
  } else {
    printDelta(data, { otherName: 'baseline' });
    console.log('Act on this with the /fix-instructions skill.\n');
  }
} catch (e) {
  console.log(`\n[eval:summary] skipped: ${e.message}\n`);
}
process.exit(0);
