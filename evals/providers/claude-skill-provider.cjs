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
        child.stdin.write(effectivePrompt);
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
// Exposed for unit tests (no agent run needed).
module.exports.stripSection = stripSection;
module.exports.applyReplacements = applyReplacements;
module.exports.applySectionStrips = applySectionStrips;
