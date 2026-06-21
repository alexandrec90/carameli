/**
 * Intra-file section-ablation driver. Removes ONE markdown section from a file (the
 * matched heading through the next same-or-higher heading) and compares against the
 * full file, scoped to the tasks that target it. Use it to find which sections of a
 * long SKILL.md earn their tokens.
 *
 * IMPORTANT: this only yields signal on a task that actually STRESSES the section.
 * Ablating the "known-fix matching" instruction does nothing on a task whose error
 * matches no known fix — you'd see "no delta" and wrongly call it dead weight. Pair
 * each section with a task that exercises it.
 *
 * Usage:
 *   node evals/section-ablate.cjs <file/path> "<heading substring>"
 *   e.g. node evals/section-ablate.cjs .claude/skills/fix-lint/SKILL.md "Known-fix matching"
 */
const { tasksTargeting, runComparison, norm } = require('./lib/runner.cjs');

const file = process.argv[2];
const heading = process.argv[3];

if (!file || !heading) {
  console.log('\nUsage: node evals/section-ablate.cjs <file/path> "<heading substring>"\n');
  process.exit(0);
}

const f = norm(file);
const safe = `section-${f.replace(/[^a-z0-9]+/gi, '-')}-${heading.replace(/[^a-z0-9]+/gi, '-').slice(0, 24)}`;

runComparison({
  description: `section-ablate "${heading}" in ${f}`,
  variant: {
    label: `no-section-${heading.slice(0, 30)}`,
    config: { stripSections: [{ path: f, heading }] },
  },
  tasks: tasksTargeting(f),
  outName: safe,
  otherName: `without "${heading}"`,
});
