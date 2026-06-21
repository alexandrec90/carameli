/**
 * Candidate-rewrite A/B driver. Compares the live instruction file against a
 * proposed rewrite, scoped to the tasks that target it, and prints the three-axis
 * delta (accuracy / tokens / latency / cost). Use it to test a specific improvement
 * hypothesis — "is this shorter version as accurate and cheaper?" — rather than just
 * "does the file help" (that's ablation).
 *
 * Keep candidate rewrites under evals/rewrites/<name>/ so skill dirs stay clean; the
 * variant file must exist at HEAD (commit it before running).
 *
 * Usage:
 *   node evals/rewrite.cjs <target/path> <variant/path>
 *   e.g. node evals/rewrite.cjs .claude/skills/fix-lint/SKILL.md evals/rewrites/fix-lint-concise/SKILL.md
 */
const { tasksTargeting, runComparison, norm } = require('./lib/runner.cjs');

const target = process.argv[2];
const variant = process.argv[3];

if (!target || !variant) {
  console.log('\nUsage: node evals/rewrite.cjs <target/path> <variant/path>\n');
  process.exit(0);
}

const t = norm(target);
const v = norm(variant);
const safe = `rewrite-${t.replace(/[^a-z0-9]+/gi, '-')}`;

runComparison({
  description: `rewrite ${t} -> ${v}`,
  variant: { label: `rewrite-${v}`, config: { replacePaths: { [t]: v } } },
  tasks: tasksTargeting(t),
  outName: safe,
  otherName: `rewrite (${v})`,
});
