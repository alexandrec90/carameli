/**
 * Seeds the broken state for the optimize-fixers ineffective-fix self-eval, run
 * inside the worktree before the agent starts. /optimize-fixers diagnoses entirely
 * from logs/agent/skills-profile.json (current) vs skills-profile.optimized.json
 * (snapshot from the last optimization), so we write both.
 *
 * The fixture is engineered so the ONLY actionable finding is an ineffective-fix
 * escalation (check 3g). Every other lever is neutralized:
 *   - 3a known-fixes compliance: known_fixes_checked == invocations
 *   - 3b new known-fix gaps:     error_patterns empty AND success_rate 0.33 (< 0.5
 *                                with >= 3 entries) gates 3b off anyway
 *   - 3c where-to-look:          files_read_freq empty
 *   - 3d bash spirals:           bash_spiral_count 0, avg_bash low
 *   - 3e stale pruning:          known-fixes row is recent with Hits > 0
 *   - 3f token cost:             avg_tokens flat (3000 -> 3000), flat history
 *   - 3g recurring escalation:   recurring_errors lists one signature that ALREADY
 *                                has a known-fixes.md row -> annotate that row
 *
 * So the only legitimate action is annotating the existing known-fixes row with
 * `(recurring — needs review)` per 3g.
 *
 * We also create a throwaway `fix-eval-fixture` skill (NOT in HEAD) whose
 * known-fixes.md carries a row matching the recurring signature. The worktree is
 * disposable, so the real .claude/skills tree is never touched.
 */
const fs = require('node:fs');
const path = require('node:path');

const SKILL = 'fix-eval-fixture';
const SKILL_DIR = `.claude/skills/${SKILL}`;

// The recurring signature — present in the ledger as `recurring` AND codified in
// known-fixes.md, so 3g must annotate the existing row rather than add a new one.
const RECURRING_SIG = 'EvalFixtureError: stale guess that did not hold';

function today() {
  return new Date().toISOString().slice(0, 10);
}

const FIXTURE_SKILL_MD = `---
name: ${SKILL}
disable-model-invocation: true
description: 'Throwaway fixer used only by the optimize-fixers ineffective-fix eval. Reads logs/eval-fixture.log and fixes the reported issues.'
---

# Skill: Fix Eval Fixture

Reads the failures in \`logs/eval-fixture.log\` and fixes them.

## Step 1 -- Known-fixes first (mandatory)

Read \`logs/eval-fixture.log\` and this skill's \`known-fixes.md\` **in parallel** as
your first action. For every error that matches a known-fix pattern, apply the fix
immediately as a one-shot — no further reading. This short-circuit is mandatory.

## Step 2 -- Fix remaining failures

For anything not covered by a known fix, diagnose from the log artifact and repair the
implicated source file, then run a single targeted verification of the thing you fixed.
`;

// known-fixes.md carries a row whose pattern matches RECURRING_SIG. Its Fix column
// is a concrete (but wrong) guess; 3g must mark it `(recurring — needs review)`.
const FIXTURE_KNOWN_FIXES = `# Known fixes for ${SKILL}

| Error pattern (substring) | Root cause | Fix | Hits | Last used | Added |
| --- | --- | --- | --- | --- | --- |
| EvalFixtureError: stale guess | wrong assumption about the seeded line | revert the seeded line | 3 | ${today()} | ${today()} |
`;

// Profile entry shape mirrors archive-session.py's update_profile output. Note
// fix_outcomes.success_rate 0.33 (< 0.5 with 3 entries -> gates 3b off) and
// recurring_errors carrying the codified signature.
const CURRENT = {
  [SKILL]: {
    invocations: 4,
    total_reads_all: 8,
    total_writes_all: 4,
    total_bash_all: 4,
    total_tokens_all: 12000,
    total_input_tokens: 6000,
    total_output_tokens: 4000,
    total_cache_creation_tokens: 1000,
    total_cache_read_tokens: 1000,
    max_consecutive_reads_ever: 3,
    max_consecutive_bash_ever: 1,
    spiral_count: 0,
    bash_spiral_count: 0,
    known_fixes_checked: 4,
    reads_history: [2, 2, 2, 2],
    tokens_history: [3000, 3000, 3000, 3000],
    error_patterns: {},
    files_read_freq: {},
    files_edited_freq: { 'app/eval_fixture.py': 4 },
    fix_outcomes: { fixed: 1, recurring: 1, open: 1, success_rate: 0.33 },
    recurring_errors: [RECURRING_SIG],
    last_seen: today(),
    avg_reads: 2.0,
    avg_writes: 1.0,
    avg_bash: 1.0,
    avg_tokens: 3000,
    avg_ratio: 2.0,
    budget_recommendation: 3,
  },
};

// Snapshot: the state at the last optimization — one invocation, no recurrence yet.
// The delta is 3 new invocations during which the fix stopped holding (recurring).
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
    fix_outcomes: { fixed: 1, recurring: 0, open: 0, success_rate: 1.0 },
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
module.exports.KNOWN_FIXES = `${SKILL_DIR}/known-fixes.md`;
module.exports.ORIGINAL_KNOWN_FIXES = FIXTURE_KNOWN_FIXES;
module.exports.RECURRING_SIG = RECURRING_SIG;
