/**
 * Seeds the broken state for the fix-instructions self-eval, run inside the
 * worktree before the agent starts. The /fix-instructions skill diagnoses from
 * evals/output/latest.json (a prior promptfoo run), so we write a realistic
 * results artifact with two tasks:
 *
 *   1. ACTIONABLE (category 3a): a naming-boundary question where the
 *      with-instructions arm underperformed (failed the correctness check, many
 *      tool calls) even though `.claude/rules/naming.md` is supposed to make it
 *      one-shot. The skill should strengthen naming.md.
 *   2. DEGENERATE BASELINE (category 3d): the baseline arm did no work
 *      (toolCalls: 0, failed) — an invalid comparison the skill must REFUSE to act
 *      on, recommending a baselinePrompt instead.
 *
 * evals/output/ is gitignored, so it's absent in a fresh worktree — we create it.
 * state.json ships with lastAddressedEvalId: null, which differs from the seeded
 * evalId, so the skill won't short-circuit on the addressed check.
 */
const fs = require('node:fs');
const path = require('node:path');

const EVAL_ID = 'selftest-fixinstr-001';

const row = (prompt, label, { success, score, verifyPassed, toolCalls, targets }) => ({
  vars: { prompt },
  provider: { id: 'file://providers/claude-skill-provider.cjs', label },
  success,
  score,
  cost: 0.05 + toolCalls * 0.004,
  tokenUsage: { total: 4000 + toolCalls * 600, prompt: 3000, completion: 1000 + toolCalls * 600 },
  latencyMs: 20000 + toolCalls * 1500,
  metadata: {
    toolCalls,
    failedToolCalls: 0,
    readsBeforeFirstEdit: Math.max(0, toolCalls - 2),
    madeAnEdit: success,
    verifyPassed,
    ...(targets ? { targets } : {}),
  },
});

const NAMING_Q =
  'At which layer does Carameli convert snake_case DB fields to the camelCase the API returns?';
const SKILL_Q = '/refactor';

const ARTIFACT = {
  evalId: EVAL_ID,
  results: {
    results: [
      // 1. Actionable — with-instructions underperformed on a rule it should enforce.
      row(NAMING_Q, 'with-instructions', {
        success: false, score: 0.2, verifyPassed: false, toolCalls: 13,
        targets: ['.claude/rules/naming.md'],
      }),
      row(NAMING_Q, 'baseline-no-instructions', {
        success: false, score: 0.1, verifyPassed: false, toolCalls: 16,
      }),
      // 2. Degenerate baseline — invalid comparison; the skill must NOT edit off it.
      row(SKILL_Q, 'with-instructions', {
        success: true, score: 1.0, verifyPassed: true, toolCalls: 7,
        targets: ['.claude/skills/refactor'],
      }),
      row(SKILL_Q, 'baseline-no-instructions', {
        success: false, score: 0.0, verifyPassed: false, toolCalls: 0,
      }),
    ],
    stats: { successes: 1, failures: 3, errors: 0 },
  },
};

module.exports = function setup(worktree) {
  const outDir = path.join(worktree, 'evals', 'output'); // gitignored, absent in a fresh worktree
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'latest.json'), JSON.stringify(ARTIFACT, null, 2));
};

module.exports.EVAL_ID = EVAL_ID;
