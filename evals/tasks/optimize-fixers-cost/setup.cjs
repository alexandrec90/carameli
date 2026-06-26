/**
 * Seeds the broken state for the optimize-fixers token-cost self-eval, run inside
 * the worktree before the agent starts. /optimize-fixers diagnoses entirely from
 * logs/agent/skills-profile.json (current) vs skills-profile.optimized.json
 * (snapshot from the last optimization), so we write both.
 *
 * The fixture is engineered so the ONLY actionable finding is a token-cost
 * regression (check 3f). Every other lever is neutralized:
 *   - 3a known-fixes compliance: known_fixes_checked == invocations
 *   - 3b new known-fix gaps:     error_patterns empty
 *   - 3c where-to-look:          files_read_freq empty
 *   - 3d bash spirals:           bash_spiral_count 0, avg_bash low
 *   - 3e stale pruning:          known-fixes row is recent with Hits > 0
 *   - 3f token cost:             avg_tokens 3000 -> 14250 (+375%), rising history
 *
 * So any edit the agent makes to the fixture skill is attributable to 3f.
 *
 * We also create a throwaway `fix-eval-fixture` skill (NOT in HEAD) for the agent
 * to edit — it has the mandatory known-fixes-first language (3a clean) but lacks
 * any context/output discipline, which is the gap 3f should close. The worktree is
 * disposable, so the real .claude/skills tree is never touched.
 */
const fs = require('node:fs');
const path = require('node:path');

const SKILL = 'fix-eval-fixture';
const SKILL_DIR = `.claude/skills/${SKILL}`;

const FIXTURE_SKILL_MD = `---
name: ${SKILL}
disable-model-invocation: true
description: 'Throwaway fixer used only by the optimize-fixers token-cost eval. Reads logs/eval-fixture.log and fixes the reported issues.'
---

# Skill: Fix Eval Fixture

Reads the failures in \`logs/eval-fixture.log\` and fixes them.

## Step 1 -- Known-fixes first (mandatory)

Read \`logs/eval-fixture.log\` and this skill's \`known-fixes.md\` **in parallel** as
your first action. For every error that matches a known-fix pattern, apply the fix
immediately as a one-shot — no further reading. This short-circuit is mandatory.

## Step 2 -- Fix remaining failures

For anything not covered by a known fix, investigate the failure and repair the
implicated source file. Re-run the full test suite and paste the complete output into
your analysis so the full picture is captured, then keep investigating broadly across
the codebase until everything is green.
`;

const FIXTURE_KNOWN_FIXES = `# Known fixes for ${SKILL}

| Error pattern (substring) | Root cause | Fix | Hits | Last used | Added |
| --- | --- | --- | --- | --- | --- |
| EvalFixtureError | seeded fixture failure | revert the seeded line | 4 | ${today()} | ${today()} |
`;

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Profile entry shape mirrors archive-session.py's update_profile output.
const CURRENT = {
  [SKILL]: {
    invocations: 4,
    total_reads_all: 8,
    total_writes_all: 4,
    total_bash_all: 4,
    total_tokens_all: 57000,
    total_input_tokens: 28000,
    total_output_tokens: 24000,
    total_cache_creation_tokens: 1000,
    total_cache_read_tokens: 4000,
    max_consecutive_reads_ever: 3,
    max_consecutive_bash_ever: 1,
    spiral_count: 0,
    bash_spiral_count: 0,
    known_fixes_checked: 4,
    reads_history: [2, 2, 2, 2],
    tokens_history: [3000, 12000, 18000, 24000],
    error_patterns: {},
    files_read_freq: {},
    files_edited_freq: { 'app/eval_fixture.py': 4 },
    last_seen: today(),
    avg_reads: 2.0,
    avg_writes: 1.0,
    avg_bash: 1.0,
    avg_tokens: 14250,
    avg_ratio: 2.0,
    budget_recommendation: 3,
  },
};

// Snapshot: the state at the last optimization — one cheap invocation. The delta is
// therefore 3 new invocations whose token cost climbed steeply.
const SNAPSHOT = {
  [SKILL]: {
    invocations: 1,
    total_reads_all: 2,
    total_writes_all: 1,
    total_bash_all: 1,
    total_tokens_all: 3000,
    total_input_tokens: 1800,
    total_output_tokens: 1000,
    total_cache_creation_tokens: 100,
    total_cache_read_tokens: 100,
    max_consecutive_reads_ever: 2,
    max_consecutive_bash_ever: 1,
    spiral_count: 0,
    bash_spiral_count: 0,
    known_fixes_checked: 1,
    reads_history: [2],
    tokens_history: [3000],
    error_patterns: {},
    files_read_freq: {},
    files_edited_freq: { 'app/eval_fixture.py': 1 },
    last_seen: today(),
    avg_reads: 2.0,
    avg_writes: 1.0,
    avg_bash: 1.0,
    avg_tokens: 3000,
    avg_ratio: 2.0,
    budget_recommendation: 3,
  },
};

module.exports = function setup(worktree) {
  const skillDir = path.join(worktree, SKILL_DIR);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), FIXTURE_SKILL_MD);
  fs.writeFileSync(path.join(skillDir, 'known-fixes.md'), FIXTURE_KNOWN_FIXES);

  const agentDir = path.join(worktree, 'logs', 'agent'); // gitignored, absent in a fresh worktree
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, 'skills-profile.json'),
    JSON.stringify(CURRENT, null, 2),
  );
  fs.writeFileSync(
    path.join(agentDir, 'skills-profile.optimized.json'),
    JSON.stringify(SNAPSHOT, null, 2),
  );
};

module.exports.SKILL_DIR = SKILL_DIR;
module.exports.SKILL_MD = `${SKILL_DIR}/SKILL.md`;
module.exports.ORIGINAL_SKILL_MD = FIXTURE_SKILL_MD;
