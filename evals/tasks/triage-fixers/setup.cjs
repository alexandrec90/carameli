/**
 * Seeds the data for the /triage-fixers read-only-triage eval, run inside the
 * worktree before the agent starts. The skill diagnoses entirely from two files:
 *   - logs/agent/skills-profile.json   (per-skill token + outcome stats)
 *   - logs/agent/error-ledger.json     (per-signature status + last_commit)
 * (plus an optional skills-profile.optimized.json snapshot for the churn delta).
 *
 * The fixture is engineered so ranking is unambiguous: one CLEARLY high-priority
 * fixer and one CLEARLY low-priority fixer.
 *
 *   fix-eval-high — low success_rate (0.25), 2 recurring ledger signatures, the
 *                   largest mean output-tokens-per-run, and the most churn since the
 *                   snapshot. Every signal points up → it must rank first.
 *   fix-eval-low  — success_rate 1.0 (all fixed), 0 recurring, cheap output, no
 *                   churn → it must rank last (or be omitted as an all-zero candidate).
 *
 * Pass = the report names fix-eval-high above fix-eval-low and cites at least one of
 * the seeded recurring signatures. logs/ is gitignored, so a fresh worktree has no
 * logs/agent dir — setup creates it.
 */
const fs = require('node:fs');
const path = require('node:path');

const HIGH = 'fix-eval-high';
const LOW = 'fix-eval-low';

// The two recurring signatures on the high-priority skill. verify.cjs requires the
// report to cite at least one of these verbatim.
const RECURRING_SIGS = [
  'FAILED tests/unit/test_high.py::test_alpha - assert 1 == 2',
  'FAILED tests/unit/test_high.py::test_beta - KeyError: customer_id',
];

function today() {
  return new Date().toISOString().slice(0, 10);
}

// ---- profile (current) ----------------------------------------------------
// Shapes mirror archive-session.py's update_profile output. Only the fields the
// triage scoring reads are populated meaningfully.
const CURRENT = {
  [HIGH]: {
    invocations: 12,
    total_output_tokens: 60000, // mean output/run = 5000 -> the max -> cost signal 1.0
    total_input_tokens: 90000,
    total_cache_read_tokens: 200000,
    total_cache_creation_tokens: 10000,
    avg_tokens: 7000,
    tokens_history: [4000, 5000, 6000, 7000, 8000], // clear upward trend
    error_patterns: {
      'FAILED tests/unit/test_high.py::test_alpha - assert 1 == 2': 4,
      'FAILED tests/unit/test_high.py::test_beta - KeyError: customer_id': 3,
      'FAILED tests/unit/test_high.py::test_gamma - TypeError': 2,
    },
    files_read_freq: {},
    files_edited_freq: { 'app/high.py': 8 },
    fix_outcomes: { fixed: 1, recurring: 2, open: 1, success_rate: 0.25 },
    recurring_errors: RECURRING_SIGS,
    last_seen: today(),
  },
  [LOW]: {
    invocations: 5,
    total_output_tokens: 2500, // mean output/run = 500 -> cost signal small
    total_input_tokens: 8000,
    total_cache_read_tokens: 20000,
    total_cache_creation_tokens: 1000,
    avg_tokens: 1800,
    tokens_history: [1800, 1800, 1800, 1800, 1800], // flat
    error_patterns: {},
    files_read_freq: {},
    files_edited_freq: { 'app/low.py': 2 },
    fix_outcomes: { fixed: 5, recurring: 0, open: 0, success_rate: 1.0 },
    recurring_errors: [],
    last_seen: today(),
  },
};

// ---- snapshot (last optimization) -----------------------------------------
// Churn delta: HIGH gained 11 invocations since the snapshot, LOW gained 0.
const SNAPSHOT = {
  [HIGH]: { invocations: 1, total_output_tokens: 4000, avg_tokens: 4000 },
  [LOW]: { invocations: 5, total_output_tokens: 2500, avg_tokens: 1800 },
};

// ---- error ledger ---------------------------------------------------------
// Keyed "<skill>::<signature>". The two HIGH signatures are `recurring` (came back
// after a fix) and carry last_commit SHAs so Plan 4 can git-show the fix attempt.
const LEDGER = {
  [`${HIGH}::${RECURRING_SIGS[0]}`]: {
    skill: HIGH,
    signature: RECURRING_SIGS[0],
    first_seen: '2026-06-20',
    last_seen: today(),
    attempts: 3,
    status: 'recurring',
    last_commit: 'a1b2c3d',
    fixed_on: '2026-06-22',
  },
  [`${HIGH}::${RECURRING_SIGS[1]}`]: {
    skill: HIGH,
    signature: RECURRING_SIGS[1],
    first_seen: '2026-06-21',
    last_seen: today(),
    attempts: 2,
    status: 'recurring',
    last_commit: 'e4f5a6b',
    fixed_on: '2026-06-23',
  },
  [`${HIGH}::FAILED tests/unit/test_high.py::test_gamma - TypeError`]: {
    skill: HIGH,
    signature: 'FAILED tests/unit/test_high.py::test_gamma - TypeError',
    first_seen: today(),
    last_seen: today(),
    attempts: 1,
    status: 'open',
    last_commit: '',
  },
  [`${LOW}::FAILED tests/unit/test_low.py::test_ok - off by one`]: {
    skill: LOW,
    signature: 'FAILED tests/unit/test_low.py::test_ok - off by one',
    first_seen: '2026-06-19',
    last_seen: '2026-06-19',
    attempts: 1,
    status: 'fixed',
    last_commit: 'deadbee',
    fixed_on: '2026-06-19',
  },
};

module.exports = function setup(worktree) {
  const agentDir = path.join(worktree, 'logs', 'agent'); // gitignored; absent in a fresh worktree
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, 'skills-profile.json'),
    JSON.stringify(CURRENT, null, 2),
  );
  fs.writeFileSync(
    path.join(agentDir, 'skills-profile.optimized.json'),
    JSON.stringify(SNAPSHOT, null, 2),
  );
  fs.writeFileSync(
    path.join(agentDir, 'error-ledger.json'),
    JSON.stringify(LEDGER, null, 2),
  );
};

module.exports.REPORT = 'logs/agent/triage-report.md';
module.exports.HIGH = HIGH;
module.exports.LOW = LOW;
module.exports.RECURRING_SIGS = RECURRING_SIGS;
