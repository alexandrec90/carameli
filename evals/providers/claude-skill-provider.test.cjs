/**
 * Unit tests for the spend guardrails in claude-skill-provider.cjs.
 *
 * These cover the pure budget helpers only — they never spawn a Claude Code agent,
 * so they run free and fast. Run with `npm run eval:test` (node's built-in runner).
 */
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const provider = require('./claude-skill-provider.cjs');
const {
  modelFromArgs,
  tierForModel,
  taskBudgetUsd,
  runBudgetUsd,
  evaluateCost,
  recordCost,
  getCumulativeCost,
  resetCumulativeCost,
  spendRecord,
  neutralizeModelEffort,
  effortFreeEnv,
  looksLikeAgentError,
  EFFORT_ENV_KEYS,
  TIER_BUDGET_USD,
  DEFAULT_RUN_BUDGET_USD,
} = provider;

// Each test starts from a clean cumulative counter and no budget env overrides.
beforeEach(() => {
  resetCumulativeCost();
  delete process.env.EVAL_MAX_USD;
  delete process.env.EVAL_TASK_MAX_USD;
});

test('modelFromArgs reads the --model value, else ""', () => {
  assert.equal(modelFromArgs(['--model', 'claude-haiku-4-5-20251001']), 'claude-haiku-4-5-20251001');
  assert.equal(modelFromArgs(['--max-turns', '40', '--model', 'claude-sonnet-4-6']), 'claude-sonnet-4-6');
  assert.equal(modelFromArgs(['--max-turns', '40']), '');
  assert.equal(modelFromArgs(undefined), '');
});

test('tierForModel maps Haiku to cheap and everything else to capable', () => {
  assert.equal(tierForModel('claude-haiku-4-5-20251001'), 'cheap');
  assert.equal(tierForModel('claude-sonnet-4-6'), 'capable');
  assert.equal(tierForModel(''), 'capable'); // unknown defaults to the safe (higher) tier
});

test('taskBudgetUsd falls back to the model-tier default', () => {
  assert.equal(taskBudgetUsd({ model: 'claude-haiku-4-5-20251001' }), TIER_BUDGET_USD.cheap);
  assert.equal(taskBudgetUsd({ model: 'claude-sonnet-4-6' }), TIER_BUDGET_USD.capable);
});

test('taskBudgetUsd precedence: task var > env > tier default', () => {
  // Tier default only.
  assert.equal(taskBudgetUsd({ model: 'claude-haiku-4-5-20251001' }), TIER_BUDGET_USD.cheap);
  // Env overrides the tier default.
  process.env.EVAL_TASK_MAX_USD = '2.5';
  assert.equal(taskBudgetUsd({ model: 'claude-haiku-4-5-20251001' }), 2.5);
  // Explicit per-task var wins over the env.
  assert.equal(taskBudgetUsd({ model: 'claude-haiku-4-5-20251001', vars: { costBudgetUsd: 0.1 } }), 0.1);
});

test('taskBudgetUsd ignores non-positive / non-numeric overrides', () => {
  process.env.EVAL_TASK_MAX_USD = 'nonsense';
  assert.equal(taskBudgetUsd({ model: 'claude-sonnet-4-6' }), TIER_BUDGET_USD.capable);
  assert.equal(taskBudgetUsd({ model: 'claude-sonnet-4-6', vars: { costBudgetUsd: 0 } }), TIER_BUDGET_USD.capable);
  assert.equal(taskBudgetUsd({ model: 'claude-sonnet-4-6', vars: { costBudgetUsd: -1 } }), TIER_BUDGET_USD.capable);
});

test('runBudgetUsd defaults, and EVAL_MAX_USD overrides', () => {
  assert.equal(runBudgetUsd(), DEFAULT_RUN_BUDGET_USD);
  process.env.EVAL_MAX_USD = '50';
  assert.equal(runBudgetUsd(), 50);
  process.env.EVAL_MAX_USD = '0'; // invalid → falls back to default
  assert.equal(runBudgetUsd(), DEFAULT_RUN_BUDGET_USD);
});

test('evaluateCost flags a run only when it exceeds its budget', () => {
  const model = 'claude-haiku-4-5-20251001'; // cheap default 0.4
  assert.equal(evaluateCost({ cost: 0.2, model }).overBudget, false);
  assert.equal(evaluateCost({ cost: TIER_BUDGET_USD.cheap, model }).overBudget, false); // exactly at budget passes
  assert.equal(evaluateCost({ cost: 0.99, model }).overBudget, true);
  // A per-task override tightens the gate.
  assert.equal(evaluateCost({ cost: 0.2, model, vars: { costBudgetUsd: 0.1 } }).overBudget, true);
});

test('evaluateCost treats missing / invalid cost as not-over-budget', () => {
  const model = 'claude-sonnet-4-6';
  assert.equal(evaluateCost({ cost: undefined, model }).overBudget, false);
  assert.equal(evaluateCost({ cost: NaN, model }).overBudget, false);
  assert.equal(evaluateCost({ cost: 0, model }).overBudget, false);
});

test('recordCost accumulates and ignores non-positive / invalid amounts', () => {
  assert.equal(getCumulativeCost(), 0);
  recordCost(0.5);
  recordCost(0.25);
  assert.equal(getCumulativeCost(), 0.75);
  recordCost(0); // ignored
  recordCost(-1); // ignored
  recordCost(undefined); // ignored
  recordCost(NaN); // ignored
  assert.equal(getCumulativeCost(), 0.75);
  resetCumulativeCost();
  assert.equal(getCumulativeCost(), 0);
});

test('spendRecord normalizes a run into a compact log line', () => {
  const r = spendRecord({
    time: '2026-06-23T00:00:00.000Z',
    provider: 'with-instructions',
    model: 'claude-haiku-4-5-20251001',
    costUsd: 0.123456,
    budgetUsd: 0.4,
    overBudget: false,
    cumulativeCostUsd: 1.234567,
    prompt: 'In this codebase, business logic such as call_control.py must import from exactly one module',
  });
  assert.equal(r.provider, 'with-instructions');
  assert.equal(r.costUsd, 0.123456);
  assert.equal(r.cumulativeUsd, 1.2346); // rounded to 4dp
  assert.equal(r.overBudget, false);
  assert.equal(r.task.length, 60); // long prompt truncated
  assert.ok(!r.task.includes('\n'));
});

test('spendRecord coerces missing / odd fields safely', () => {
  const r = spendRecord({ time: 't', overBudget: 1, prompt: undefined });
  assert.equal(r.costUsd, 0);
  assert.equal(r.cumulativeUsd, 0);
  assert.equal(r.overBudget, true); // truthy → boolean
  assert.equal(r.task, '');
});

test('neutralizeModelEffort strips effort/thinking knobs, keeps the rest', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-settings-'));
  try {
    fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
    const settingsPath = path.join(dir, '.claude', 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({
      env: {
        MAX_THINKING_TOKENS: '63999',
        CLAUDE_CODE_ALWAYS_ENABLE_EFFORT: '1',
        CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: '1',
        CLAUDE_CODE_USE_POWERSHELL_TOOL: '1', // unrelated — must survive
      },
      effortLevel: 'high',
      permissions: { defaultMode: 'bypassPermissions' }, // must survive
      hooks: { Stop: [{ hooks: [] }] }, // must survive
    }));

    const changed = neutralizeModelEffort(dir);
    assert.equal(changed, true);

    const out = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.equal('effortLevel' in out, false);
    for (const k of EFFORT_ENV_KEYS) assert.equal(k in out.env, false);
    // Everything not effort-related is preserved.
    assert.equal(out.env.CLAUDE_CODE_USE_POWERSHELL_TOOL, '1');
    assert.equal(out.permissions.defaultMode, 'bypassPermissions');
    assert.ok(out.hooks.Stop);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('neutralizeModelEffort is a no-op when there is no settings file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-settings-'));
  try {
    assert.equal(neutralizeModelEffort(dir), false); // stripped baseline has no .claude
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('effortFreeEnv strips inherited effort/thinking vars, keeps the rest', () => {
  const out = effortFreeEnv({
    PATH: '/usr/bin',
    CLAUDE_CODE_ALWAYS_ENABLE_EFFORT: '1',
    MAX_THINKING_TOKENS: '63999',
    CLAUDE_EFFORT: 'high',
    CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING: '1',
    CLAUDE_CODE_USE_POWERSHELL_TOOL: '1', // unrelated — must survive
  });
  assert.equal(out.PATH, '/usr/bin');
  assert.equal(out.CLAUDE_CODE_USE_POWERSHELL_TOOL, '1');
  assert.equal('CLAUDE_CODE_ALWAYS_ENABLE_EFFORT' in out, false);
  assert.equal('MAX_THINKING_TOKENS' in out, false);
  assert.equal('CLAUDE_EFFORT' in out, false);
  assert.equal('CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING' in out, false);
});

test('looksLikeAgentError flags API errors and dead runs, not normal output', () => {
  assert.equal(looksLikeAgentError('API Error: 400 effort not supported', false), true);
  assert.equal(looksLikeAgentError('Error: spawn claude ENOENT', false), true);
  assert.equal(looksLikeAgentError('', true), true); // is_error flag from the result event
  assert.equal(looksLikeAgentError('base.py', false), false); // a real answer
  assert.equal(looksLikeAgentError('The fix is in handler.py', false), false);
});

test('cumulative total crosses the run cap as costs accrue', () => {
  process.env.EVAL_MAX_USD = '1';
  assert.ok(getCumulativeCost() < runBudgetUsd());
  recordCost(0.6);
  assert.ok(getCumulativeCost() < runBudgetUsd()); // 0.6 < 1, still spawning
  recordCost(0.6);
  assert.ok(getCumulativeCost() >= runBudgetUsd()); // 1.2 >= 1, short-circuit from here
});
