/**
 * Shared machinery for the on-demand comparison drivers (ablate / rewrite /
 * section-ablate). Each driver builds a throwaway two-provider config —
 * `with-instructions` vs some variant arm — scoped to the tasks that target the
 * file under test, runs promptfoo, and prints the delta. This module owns the parts
 * they share: task discovery and the run itself.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const yaml = require('js-yaml');
const { load, printDelta } = require('./compare.cjs');

const EVALS_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(EVALS_DIR, '..');
const MAIN_CONFIG = path.join(EVALS_DIR, 'promptfooconfig.yaml');
const PROVIDER = 'file://providers/claude-skill-provider.cjs';
const norm = (p) => p.split(path.sep).join('/').replace(/\/+$/, '');

// Parseable failure artifact for the comparison drivers. When a run errors before
// promptfoo writes its JSON, the streamed terminal output is gone — so we capture it
// here for a coding agent to fix from. See .claude/rules/tooling.md (Failure artifacts)
// and .claude/rules/diagnostics.md for the format.
const ERROR_ARTIFACT = path.join(REPO_ROOT, 'logs', 'eval-errors.log');
const OUTPUT_CAP = 8000; // bytes of captured stdout/stderr kept in the artifact

// All tasks with their declared target files.
function allTasks() {
  const tasksDir = path.join(EVALS_DIR, 'tasks');
  const out = [];
  if (!fs.existsSync(tasksDir)) return out;
  for (const d of fs.readdirSync(tasksDir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const testPath = path.join(tasksDir, d.name, 'test.yaml');
    if (!fs.existsSync(testPath)) continue;
    let doc;
    try {
      doc = yaml.load(fs.readFileSync(testPath, 'utf8'));
    } catch {
      continue;
    }
    const targets = new Set();
    for (const t of Array.isArray(doc) ? doc : [doc]) {
      for (const tg of t?.metadata?.targets ?? []) targets.add(norm(tg));
    }
    out.push({ name: d.name, rel: `tasks/${d.name}/test.yaml`, targets: [...targets] });
  }
  return out;
}

// Tasks relevant to a path: exact target match, or the path lives under a targeted
// dir (so a SKILL.md matches tasks targeting its skill dir).
function tasksTargeting(p) {
  const q = norm(p);
  return allTasks().filter((t) =>
    t.targets.some((tg) => tg === q || q.startsWith(`${tg}/`) || tg.startsWith(`${q}/`)),
  );
}

/**
 * Build the comparison's provider set from the main config's providers, so each
 * task's pinned `providers:` (`with-instructions[-capable]` / `baseline-*`) resolves
 * — promptfoo hard-fails a run that references a provider the active config doesn't
 * define. Reusing the canonical labels also preserves each task's TIER: the per-tier
 * `extraArgs` (model + `--max-turns`) carry over, so a capable task still runs on
 * Sonnet. The `with-instructions*` arms run the full instruction set; the `baseline-*`
 * arms are repurposed to carry the variant transform (ablate / rewrite / section)
 * instead of stripping all instructions — that's the comparison the drivers want.
 */
function buildProviders(baseProviders, variantConfig) {
  return (baseProviders || []).map((p) => {
    const isWith = String(p.label).startsWith('with-instructions');
    const config = { baseRef: 'HEAD' };
    if (p.config && p.config.extraArgs) config.extraArgs = p.config.extraArgs;
    return {
      id: PROVIDER,
      label: p.label,
      config: isWith ? config : { ...config, ...variantConfig },
    };
  });
}

// Persist a failed comparison run to a parseable artifact (terminal output is lost
// once the run errors). Head/tail-capped per the byte-cap guidance. Never throws.
function writeErrorArtifact({ description, res }) {
  const tail = (s) => String(s || '').slice(-OUTPUT_CAP);
  const parts = [`# source: evals/lib/runner.cjs — ${description}`];
  if (res?.error) parts.push(`spawn error: ${res.error.message || res.error}`);
  if (res?.status != null) parts.push(`promptfoo exit code: ${res.status}`);
  if (res?.stderr) parts.push('', '--- stderr (tail) ---', tail(res.stderr));
  if (res?.stdout) parts.push('', '--- stdout (tail) ---', tail(res.stdout));
  try {
    fs.mkdirSync(path.dirname(ERROR_ARTIFACT), { recursive: true });
    fs.writeFileSync(ERROR_ARTIFACT, `${parts.join('\n')}\n`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Run `with-instructions` against one variant arm on the given tasks, print the
 * delta. `variant` = { config } for the baseline arms' transform; `otherName` labels
 * the comparison arm in the output.
 */
function runComparison({ description, variant, tasks, outName, otherName }) {
  if (!tasks.length) {
    console.log(`\n[${description}] No task targets this file. Add it to a task's`);
    console.log('metadata.targets, or run `npm run eval:coverage` to see gaps.\n');
    return;
  }

  const base = yaml.load(fs.readFileSync(MAIN_CONFIG, 'utf8'));
  const cfg = {
    description,
    prompts: base.prompts,
    providers: buildProviders(base.providers, variant.config),
    defaultTest: base.defaultTest,
    tests: tasks.map((t) => t.rel),
  };

  const tmpConfig = path.join(EVALS_DIR, `.${outName}.yaml`);
  const outPath = path.join(EVALS_DIR, 'output', `${outName}.json`);
  fs.writeFileSync(tmpConfig, yaml.dump(cfg));
  // Drop any stale output from a previous run so a crash can't make us read and
  // print last time's results as if they were fresh.
  fs.rmSync(outPath, { force: true });

  console.log(`\n[${description}]  tasks: ${tasks.map((t) => t.name).join(', ')}`);
  console.log('(terminal is quiet during the run — tail logs/eval-spend.log for live progress)');
  try {
    // Capture rather than inherit: minimal terminal noise, and the actionable output
    // lands in an artifact if the run errors before promptfoo writes its JSON.
    const res = spawnSync('npx', ['promptfoo', 'eval', '-c', tmpConfig, '-o', outPath], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      shell: true,
      maxBuffer: 128 * 1024 * 1024,
    });
    const data = load(outPath);
    if (data) {
      printDelta(data, { otherName });
    } else {
      writeErrorArtifact({ description, res });
      console.log(`\n[${description}] Run failed before producing results.`);
      console.log(`Diagnostics written to ${norm(path.relative(REPO_ROOT, ERROR_ARTIFACT))} — read that to fix.`);
    }
  } finally {
    fs.rmSync(tmpConfig, { force: true });
  }
}

module.exports = { allTasks, tasksTargeting, runComparison, buildProviders, norm, EVALS_DIR, REPO_ROOT };
