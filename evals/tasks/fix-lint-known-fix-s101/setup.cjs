/**
 * Seeds logs/lint-errors.log with an S101 error — a pattern that HAS a row in
 * fix-lint/known-fixes.md. This task stresses the skill's known-fix short-circuit,
 * so it's the one to use when section-ablating the "Known-fix matching" section:
 *   node evals/section-ablate.cjs .claude/skills/fix-lint/SKILL.md "Known-fix matching"
 * With the section present the agent should consult known-fixes.md and one-shot the
 * fix (fewer reads/tokens); without it, it diagnoses from scratch.
 */
const { writeLog } = require('../../lib/fixture.cjs');

const LOG = `# ruff
evals/fixtures/fix-lint-known/test_sample.py:8:5: S101 Use of \`assert\` detected
`;

module.exports = function setup(worktree) {
  writeLog(worktree, 'logs/lint-errors.log', LOG);
};
