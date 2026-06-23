/**
 * Custom promptfoo provider that runs Claude Code headless against an isolated
 * git worktree, then parses the stream-json transcript into behavioral metrics.
 *
 * Why a custom provider instead of the built-in `anthropic:` one:
 *   The instruction files (CLAUDE.md + .claude/) only take effect when a task is
 *   run *through the Claude Code agent loop*. A raw API call never loads them.
 *   This provider runs the real agent, so the metrics reflect the real behavior.
 *
 * Isolation: every call runs in a throwaway `git worktree` detached at `baseRef`,
 *   so fixer skills that edit files never touch the live repo. The worktree is
 *   removed after each run.
 *
 * Config (per-provider, set in promptfooconfig.yaml):
 *   baseRef            git ref to check the worktree out at (default: "HEAD")
 *   stripInstructions  delete CLAUDE.md + .claude/ in the worktree before running
 *                      (default: false). Use a second provider with this on to get
 *                      the no-instructions baseline.
 *   stripPaths         array of repo-relative paths (files or dirs) to delete from
 *                      the worktree before running, e.g.
 *                      ['.claude/rules/voip-providers.md']. This is the leave-one-out
 *                      ablation knob: keep every instruction file except the target,
 *                      to measure what that ONE file is worth. Ignored when
 *                      stripInstructions is true (strip-all is a superset).
 *   replacePaths       { targetRel: variantRel } — overwrite each target file with a
 *                      candidate variant before running (both present at HEAD). The
 *                      candidate-rewrite A/B knob: compare the live skill against a
 *                      proposed rewrite kept under evals/rewrites/. The skill stays in
 *                      place, so the real /skill runs against the new content.
 *   stripSections      [{ path, heading }] — remove one markdown section (matched
 *                      heading through the next same-or-higher heading) from each
 *                      file. Intra-file ablation: measure what a single SECTION of a
 *                      SKILL.md is worth, given a task that stresses it.
 *   timeoutMs          hard kill for a single run (default: 180000)
 *   extraArgs          extra CLI args passed to `claude` (array of strings)
 *
 * Per-task var (set in a task's test.yaml):
 *   baselinePrompt     natural-language prompt the stripped arm receives INSTEAD of
 *                      `prompt`. Use it for skill tasks (prompt: /some-skill): with
 *                      instructions stripped the slash command can't resolve, so a
 *                      bare `/skill` baseline measures "skill vs typo", not "skill vs
 *                      unguided agent". Supplying the skill's plain-English equivalent
 *                      here makes the baseline a fair comparison. Ignored when
 *                      stripInstructions is false (the with-instructions arm always
 *                      gets the real `prompt`).
 *
 * Returns to promptfoo:
 *   output       the agent's final result text (what assertions match against)
 *   tokenUsage   { total, prompt, completion } — auto-aggregated in the table
 *   cost         total_cost_usd — auto-aggregated in the table
 *   metadata     behavioral metrics (assert via context.providerResponse.metadata):
 *                  toolCalls, failedToolCalls, numTurns, toolNames,
 *                  readsBeforeFirstEdit  (investigation-spiral signal),
 *                  madeAnEdit
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const EVALS_DIR = path.resolve(__dirname, '..');
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob']);
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit']);

// --- Spend guardrails -------------------------------------------------------
// Each task spawns a real Claude Code agent, so an unbounded run can drain a
// whole token budget — which is exactly what `eval:stable --repeat 3` did. Three
// layers cap spend:
//   1. `--max-turns` (set in promptfooconfig) bounds a single agent's loop.
//   2. A per-task USD ceiling: the run's cost is compared to a budget and the
//      result surfaced as `metadata.overBudget`; a defaultTest assertion fails any
//      over-budget run, so cost is a first-class pass/fail axis, not just a column.
//   3. A cumulative run ceiling (EVAL_MAX_USD) enforced here: once the whole run
//      crosses it, remaining calls short-circuit before spawning another agent.

// Default per-task ceilings by model tier. Healthy runs observed: Haiku tasks
// peak ~$0.26, Sonnet tasks ~$0.55 — these sit ~1.5-1.8x above that, so a clear
// blowout fails while normal runs pass. Override per task with
// `vars.costBudgetUsd`, or globally with EVAL_TASK_MAX_USD.
const TIER_BUDGET_USD = { cheap: 0.4, capable: 1.0 };

// Default whole-run ceiling. A single full pass costs ~$7; `--repeat 3` ~$20.
// $20 lets a normal pass finish but trips on a runaway. Override with EVAL_MAX_USD.
const DEFAULT_RUN_BUDGET_USD = 20;

// A positive numeric env var, or undefined when unset/invalid.
function positiveEnv(name) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : undefined;
}

// `--model X` in the provider's extraArgs → 'X' (or '' when unset).
function modelFromArgs(extraArgs) {
  const i = (extraArgs || []).indexOf('--model');
  return i >= 0 ? String(extraArgs[i + 1] || '') : '';
}

// Tier from the model string: cheap (Haiku) vs capable (Sonnet / anything else).
function tierForModel(model) {
  return /haiku/i.test(model || '') ? 'cheap' : 'capable';
}

// Per-task USD ceiling: explicit task var > EVAL_TASK_MAX_USD > model-tier default.
function taskBudgetUsd({ vars, model } = {}) {
  const fromVar = Number(vars?.costBudgetUsd);
  if (Number.isFinite(fromVar) && fromVar > 0) return fromVar;
  return positiveEnv('EVAL_TASK_MAX_USD') ?? TIER_BUDGET_USD[tierForModel(model)];
}

// Whole-run ceiling: EVAL_MAX_USD > built-in default.
function runBudgetUsd() {
  return positiveEnv('EVAL_MAX_USD') ?? DEFAULT_RUN_BUDGET_USD;
}

// { budgetUsd, overBudget } for one run. A non-positive/NaN cost is never over.
function evaluateCost({ cost, vars, model } = {}) {
  const budgetUsd = taskBudgetUsd({ vars, model });
  const n = Number(cost);
  return { budgetUsd, overBudget: Number.isFinite(n) && n > budgetUsd };
}

// Cumulative spend across the run. promptfoo require()s this module once, so the
// counter persists across every task/arm in a single `promptfoo eval`.
let cumulativeCostUsd = 0;
function recordCost(usd) {
  const n = Number(usd);
  if (Number.isFinite(n) && n > 0) cumulativeCostUsd += n;
  return cumulativeCostUsd;
}
function getCumulativeCost() { return cumulativeCostUsd; }
function resetCumulativeCost() { cumulativeCostUsd = 0; } // test hook

// Append-per-run spend log. The JSON artifact (evals/output/latest.json) is only
// written when promptfoo finishes, so a run killed mid-way leaves no trace — this
// flushes one line as each run completes (and on a budget short-circuit), so you
// can always reconstruct where the money went. logs/ is gitignored.
const SPEND_LOG = path.join(REPO_ROOT, 'logs', 'eval-spend.log');

// Normalize a completed run into a compact log record. Pure → unit-tested.
function spendRecord({ time, provider, model, costUsd, budgetUsd, overBudget, cumulativeCostUsd: cum, prompt }) {
  return {
    time,
    provider,
    model,
    costUsd: Number(costUsd) || 0,
    budgetUsd,
    overBudget: !!overBudget,
    cumulativeUsd: Math.round((Number(cum) || 0) * 1e4) / 1e4,
    task: String(prompt ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
  };
}

function appendSpendLog(record) {
  try {
    fs.mkdirSync(path.dirname(SPEND_LOG), { recursive: true });
    fs.appendFileSync(SPEND_LOG, `${JSON.stringify(record)}\n`);
  } catch { /* logging must never break a run */ }
}

function git(args, cwd = REPO_ROOT) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

// Optional per-task hook: a .cjs module (path relative to evals/) exporting a
// function called with the worktree path. `setup` seeds broken state before the
// agent runs; `verify` returns truthy if the repaired worktree is correct.
function runHook(relPath, worktree) {
  return require(path.resolve(EVALS_DIR, relPath))(worktree);
}

function rmInstructions(worktree) {
  // root + any nested CLAUDE.md, plus the whole .claude tree
  fs.rmSync(path.join(worktree, '.claude'), { recursive: true, force: true });
  const stack = [worktree];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === 'CLAUDE.md') fs.rmSync(full, { force: true });
    }
  }
}

// Leave-one-out ablation: delete just the named paths (files or dirs).
function rmPaths(worktree, relPaths) {
  for (const rel of relPaths) {
    // normalize separators so config can use forward slashes on Windows
    const full = path.join(worktree, rel.split('/').join(path.sep));
    fs.rmSync(full, { recursive: true, force: true });
  }
}

// The repo's .claude/settings.json carries interactive-session model knobs —
// effortLevel + a 64k MAX_THINKING_TOKENS budget + always-enable-effort — that are
// wrong for headless evals: they 400 on models with no effort support (Haiku), burn
// a huge thinking-token budget every turn (the real subscription-quota sink), and
// exist only in the with-instructions arm, so they CONFOUND the comparison with
// effort rather than instruction content. Strip them in the worktree so every arm
// runs at the model's default effort. Returns true if it changed the file.
const EFFORT_ENV_KEYS = [
  'MAX_THINKING_TOKENS',
  'CLAUDE_CODE_ALWAYS_ENABLE_EFFORT',
  'CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING',
];
function neutralizeModelEffort(worktree) {
  const p = path.join(worktree, '.claude', 'settings.json');
  if (!fs.existsSync(p)) return false;
  let doc;
  try { doc = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return false; }
  let changed = false;
  if (doc && typeof doc === 'object' && 'effortLevel' in doc) {
    delete doc.effortLevel;
    changed = true;
  }
  if (doc && doc.env && typeof doc.env === 'object') {
    for (const k of EFFORT_ENV_KEYS) {
      if (k in doc.env) { delete doc.env[k]; changed = true; }
    }
  }
  if (changed) fs.writeFileSync(p, `${JSON.stringify(doc, null, 2)}\n`);
  return changed;
}

// The worktree file is only half the problem: effort/thinking are ALSO forced by
// inherited env vars (CLAUDE_CODE_ALWAYS_ENABLE_EFFORT, MAX_THINKING_TOKENS,
// CLAUDE_EFFORT, …) whenever the eval is launched from a shell that has them set —
// e.g. an interactive Claude Code session. Those reach the spawned agent regardless
// of the worktree, and 400 on models without effort support (Haiku). Strip every
// effort/thinking var from the child's env so it runs at the model's default.
function effortFreeEnv(env = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) {
    if (/EFFORT|THINKING/i.test(k)) continue;
    out[k] = v;
  }
  return out;
}

// A /skill prompt only resolves if its skill dir is present. When the arm under
// test removes that skill (strip-all, or ablating the skill itself), fall back to
// the task's plain-English baselinePrompt so we measure "skill vs unguided agent"
// rather than "skill vs unresolved command". Ablating an UNRELATED file leaves the
// skill in place, so the real /skill still runs — that's what we want there.
function stripsInvokedSkill(prompt, stripPaths) {
  const m = /^\/([a-z0-9-]+)/i.exec(String(prompt).trim());
  if (!m) return false;
  const needle = `.claude/skills/${m[1]}`;
  return (stripPaths || []).some((p) => p.split('\\').join('/').replace(/\/+$/, '').endsWith(needle));
}

// Candidate-rewrite A/B: overwrite each target file with the content of a variant
// file (both repo-relative, present in the worktree at HEAD). The skill stays in
// place, so the real /skill runs against the rewritten content.
function applyReplacements(worktree, replaceMap) {
  for (const [target, variant] of Object.entries(replaceMap)) {
    const dst = path.join(worktree, target.split('/').join(path.sep));
    const src = path.join(worktree, variant.split('/').join(path.sep));
    fs.writeFileSync(dst, fs.readFileSync(src));
  }
}

// Remove a single markdown section (the matched heading line through the line
// before the next heading of the same or higher level) from `text`. No-op if the
// heading isn't found. Used for intra-file section ablation.
function stripSection(text, headingNeedle) {
  const lines = text.split(/\r?\n/);
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*)$/.exec(lines[i]);
    if (m && m[2].includes(headingNeedle)) { start = i; level = m[1].length; break; }
  }
  if (start === -1) return text;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#{1,6})\s+/.exec(lines[i]);
    if (m && m[1].length <= level) { end = i; break; }
  }
  lines.splice(start, end - start);
  return lines.join('\n');
}

// stripSections: [{ path, heading }] — drop the named section from each file.
function applySectionStrips(worktree, sections) {
  for (const { path: rel, heading } of sections) {
    const full = path.join(worktree, rel.split('/').join(path.sep));
    fs.writeFileSync(full, stripSection(fs.readFileSync(full, 'utf8'), heading));
  }
}

function parseTranscript(lines) {
  const m = {
    toolCalls: 0,
    failedToolCalls: 0,
    numTurns: 0,
    toolNames: [],
    readsBeforeFirstEdit: 0,
    madeAnEdit: false,
  };
  let result = '';
  let usage = { input_tokens: 0, output_tokens: 0 };
  let cost = 0;
  let isError = false;

  for (const line of lines) {
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }

    if (ev.type === 'assistant' && ev.message?.content) {
      for (const block of ev.message.content) {
        if (block.type !== 'tool_use') continue;
        m.toolCalls += 1;
        m.toolNames.push(block.name);
        if (EDIT_TOOLS.has(block.name)) m.madeAnEdit = true;
        else if (READ_TOOLS.has(block.name) && !m.madeAnEdit) m.readsBeforeFirstEdit += 1;
      }
    } else if (ev.type === 'user' && ev.message?.content) {
      for (const block of ev.message.content) {
        if (block.type === 'tool_result' && block.is_error === true) m.failedToolCalls += 1;
      }
    } else if (ev.type === 'result') {
      result = ev.result ?? '';
      usage = ev.usage ?? usage;
      cost = ev.total_cost_usd ?? 0;
      m.numTurns = ev.num_turns ?? 0;
      // The agent itself failed (e.g. an API 400) rather than just answering wrong.
      // Surface it so a misconfigured model doesn't masquerade as a bad instruction
      // file — the result text is the error payload in that case.
      if (ev.is_error === true || /^(API Error|Error:)/.test(String(result))) isError = true;
    }
  }
  return { metrics: m, result, usage, cost, isError };
}

// A run with no result event at all (process died before finishing) is also a
// failure, not a clean answer.
function looksLikeAgentError(result, isError) {
  return isError || /^(API Error|Error:)/.test(String(result || ''));
}

class ClaudeSkillProvider {
  constructor(options = {}) {
    this.config = options.config || {};
    this.providerId = options.id || 'claude-skill';
  }

  id() { return this.providerId; }

  async callApi(prompt, context) {
    // Cumulative run-budget kill switch: once the whole run has spent past the
    // ceiling, stop spawning agents. Returns an error so remaining tests fail fast
    // and cheap instead of draining the budget. Checked before any worktree work.
    const runCap = runBudgetUsd();
    if (getCumulativeCost() >= runCap) {
      appendSpendLog({
        time: new Date().toISOString(),
        event: 'skipped: run budget reached',
        cumulativeUsd: Math.round(getCumulativeCost() * 1e4) / 1e4,
        capUsd: runCap,
      });
      return {
        error: `eval run budget reached: spent $${getCumulativeCost().toFixed(4)} >= $${runCap} (EVAL_MAX_USD). Skipped without spawning an agent; raise EVAL_MAX_USD to continue.`,
      };
    }

    const baseRef = this.config.baseRef || 'HEAD';
    const timeoutMs = this.config.timeoutMs || 180000;
    const setupRel = context?.vars?.setup;
    const verifyRel = context?.vars?.verify;
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'carameli-eval-'));

    // mkdtemp made the dir; `git worktree add` needs it not to exist yet.
    fs.rmSync(worktree, { recursive: true, force: true });

    // When the arm under test no longer has the invoked /skill, fall back to the
    // task's plain-English baselinePrompt so the comparison stays fair.
    const stripPaths = Array.isArray(this.config.stripPaths) ? this.config.stripPaths : [];
    const baselinePrompt = context?.vars?.baselinePrompt;
    const skillGone = this.config.stripInstructions || stripsInvokedSkill(prompt, stripPaths);
    const effectivePrompt = skillGone && baselinePrompt ? String(baselinePrompt) : prompt;

    try {
      git(['worktree', 'add', '--detach', worktree, baseRef]);
      if (this.config.stripInstructions) rmInstructions(worktree);
      else if (stripPaths.length) rmPaths(worktree, stripPaths);
      if (this.config.replacePaths) applyReplacements(worktree, this.config.replacePaths);
      if (Array.isArray(this.config.stripSections)) applySectionStrips(worktree, this.config.stripSections);
      // Always run at the model's default effort so Haiku doesn't 400 on the effort
      // param and the thinking-token budget can't balloon the run (and so effort
      // isn't a hidden variable between arms). No-op on the stripped baseline.
      neutralizeModelEffort(worktree);
      if (setupRel) runHook(setupRel, worktree); // seed broken state for fixer tasks

      const args = [
        '-p',
        '--output-format', 'stream-json',
        '--verbose',
        '--dangerously-skip-permissions', // safe: throwaway worktree
        ...(this.config.extraArgs || []),
      ];

      const stdout = await new Promise((resolve, reject) => {
        // shell:true so the `claude` (.cmd on Windows) shim resolves; args are
        // static and the prompt goes over stdin, so there is no injection risk.
        const child = spawn('claude', args, { cwd: worktree, shell: true, env: effortFreeEnv() });
        let out = '';
        let err = '';
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`timeout after ${timeoutMs}ms`)); }, timeoutMs);
        child.stdout.on('data', (d) => { out += d; });
        child.stderr.on('data', (d) => { err += d; });
        child.on('error', (e) => { clearTimeout(timer); reject(e); });
        child.on('close', (code) => {
          clearTimeout(timer);
          if (code !== 0 && !out) reject(new Error(`claude exited ${code}: ${err.slice(-500)}`));
          else resolve(out);
        });
        child.stdin.write(effectivePrompt);
        child.stdin.end();
      });

      const { metrics, result, usage, cost, isError } = parseTranscript(stdout.split('\n'));

      // An agent-level failure (API 400, dead process) is an ERROR, not a $0 "fail":
      // returning it as output would let a misconfigured model look like a useless
      // instruction file. Surface it loudly and log it.
      if (looksLikeAgentError(result, isError)) {
        appendSpendLog({
          time: new Date().toISOString(),
          event: 'agent error',
          provider: this.providerId,
          model: modelFromArgs(this.config.extraArgs),
          detail: String(result).replace(/\s+/g, ' ').trim().slice(0, 200),
        });
        return { error: `agent run failed: ${String(result).replace(/\s+/g, ' ').trim().slice(0, 300)}` };
      }

      // Spend bookkeeping: add this run to the cumulative total and decide whether
      // it blew its per-task budget. `overBudget` is asserted on in defaultTest, so
      // an over-budget run fails the task even if the output was correct — cost is a
      // first-class optimization axis here, not just a reported column.
      recordCost(cost);
      const model = modelFromArgs(this.config.extraArgs);
      const { budgetUsd, overBudget } = evaluateCost({ cost, vars: context?.vars, model });
      metrics.costUsd = cost;
      metrics.costBudgetUsd = budgetUsd;
      metrics.overBudget = overBudget;
      metrics.cumulativeCostUsd = getCumulativeCost();

      appendSpendLog(spendRecord({
        time: new Date().toISOString(),
        provider: this.providerId,
        model,
        costUsd: cost,
        budgetUsd,
        overBudget,
        cumulativeCostUsd: getCumulativeCost(),
        prompt: effectivePrompt,
      }));

      // Verify the repaired worktree BEFORE teardown — the worktree is gone by
      // the time promptfoo runs its assertions, so correctness must be captured
      // here and surfaced as a metric.
      if (verifyRel) metrics.verifyPassed = !!runHook(verifyRel, worktree);

      return {
        output: result,
        tokenUsage: {
          total: (usage.input_tokens || 0) + (usage.output_tokens || 0),
          prompt: usage.input_tokens || 0,
          completion: usage.output_tokens || 0,
        },
        cost,
        metadata: metrics,
      };
    } catch (e) {
      return { error: String(e.message || e) };
    } finally {
      try { git(['worktree', 'remove', '--force', worktree]); } catch { /* best effort */ }
      fs.rmSync(worktree, { recursive: true, force: true });
    }
  }
}

module.exports = ClaudeSkillProvider;
// Exposed for unit tests (no agent run needed).
module.exports.stripSection = stripSection;
module.exports.applyReplacements = applyReplacements;
module.exports.applySectionStrips = applySectionStrips;
module.exports.neutralizeModelEffort = neutralizeModelEffort;
module.exports.effortFreeEnv = effortFreeEnv;
module.exports.looksLikeAgentError = looksLikeAgentError;
module.exports.EFFORT_ENV_KEYS = EFFORT_ENV_KEYS;
// Spend-guardrail helpers (pure — testable without spawning an agent).
module.exports.modelFromArgs = modelFromArgs;
module.exports.tierForModel = tierForModel;
module.exports.taskBudgetUsd = taskBudgetUsd;
module.exports.runBudgetUsd = runBudgetUsd;
module.exports.evaluateCost = evaluateCost;
module.exports.recordCost = recordCost;
module.exports.getCumulativeCost = getCumulativeCost;
module.exports.resetCumulativeCost = resetCumulativeCost;
module.exports.spendRecord = spendRecord;
module.exports.TIER_BUDGET_USD = TIER_BUDGET_USD;
module.exports.DEFAULT_RUN_BUDGET_USD = DEFAULT_RUN_BUDGET_USD;
