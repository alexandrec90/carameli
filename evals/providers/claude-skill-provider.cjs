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
 *   timeoutMs          hard kill for a single run (default: 180000)
 *   extraArgs          extra CLI args passed to `claude` (array of strings)
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
    }
  }
  return { metrics: m, result, usage, cost };
}

class ClaudeSkillProvider {
  constructor(options = {}) {
    this.config = options.config || {};
    this.providerId = options.id || 'claude-skill';
  }

  id() { return this.providerId; }

  async callApi(prompt, context) {
    const baseRef = this.config.baseRef || 'HEAD';
    const timeoutMs = this.config.timeoutMs || 180000;
    const setupRel = context?.vars?.setup;
    const verifyRel = context?.vars?.verify;
    const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'carameli-eval-'));

    // mkdtemp made the dir; `git worktree add` needs it not to exist yet.
    fs.rmSync(worktree, { recursive: true, force: true });

    try {
      git(['worktree', 'add', '--detach', worktree, baseRef]);
      if (this.config.stripInstructions) rmInstructions(worktree);
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
        const child = spawn('claude', args, { cwd: worktree, shell: true });
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
        child.stdin.write(prompt);
        child.stdin.end();
      });

      const { metrics, result, usage, cost } = parseTranscript(stdout.split('\n'));

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
