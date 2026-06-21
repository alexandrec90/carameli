/**
 * Leave-one-out ablation driver + coverage view for the instruction-file evals.
 *
 * Testing whether ONE instruction file earns its tokens means running the suite
 * with just that file removed and comparing to the full set. Doing that as permanent
 * extra providers would multiply every run's cost, so this drives it on demand,
 * scoped to the tasks that target the file (via metadata.targets).
 *
 * Usage:
 *   node evals/ablate.cjs --coverage            # FREE: file -> task map + gaps, no agent runs
 *   node evals/ablate.cjs <repo/rel/path>       # ablate one file/dir against its tasks
 *   node evals/ablate.cjs --all                 # ablate every targeted file (slow, costs $)
 */
const fs = require('node:fs');
const path = require('node:path');
const { allTasks, tasksTargeting, runComparison, norm, REPO_ROOT } = require('./lib/runner.cjs');

// ---- enumerate the instruction files we can test --------------------------

function walkForClaudeMd(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.claude'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkForClaudeMd(full, acc);
    else if (entry.name === 'CLAUDE.md') acc.push(norm(path.relative(REPO_ROOT, full)));
  }
}

function instructionUnits() {
  const units = [];
  walkForClaudeMd(REPO_ROOT, units);

  const rulesDir = path.join(REPO_ROOT, '.claude', 'rules');
  if (fs.existsSync(rulesDir)) {
    for (const f of fs.readdirSync(rulesDir)) {
      if (f.endsWith('.md')) units.push(`.claude/rules/${f}`);
    }
  }

  const skillsDir = path.join(REPO_ROOT, '.claude', 'skills');
  if (fs.existsSync(skillsDir)) {
    for (const d of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (d.isDirectory()) units.push(`.claude/skills/${d.name}`);
    }
  }
  return units.sort();
}

// ---- coverage view --------------------------------------------------------

function coverage() {
  const units = instructionUnits();
  const targetedBy = new Map(); // file -> [task names]
  for (const t of allTasks()) for (const tg of t.targets) {
    if (!targetedBy.has(tg)) targetedBy.set(tg, []);
    targetedBy.get(tg).push(t.name);
  }

  console.log('\n===== Instruction-file coverage =====');
  console.log('Each file and which task(s) ablate-test it. Gaps = files no task measures.\n');

  const gaps = [];
  for (const u of units) {
    const hit = targetedBy.get(u);
    if (hit) console.log(`  [covered] ${u}  <- ${hit.join(', ')}`);
    else { console.log(`  [ GAP   ] ${u}`); gaps.push(u); }
  }

  const unitSet = new Set(units);
  const stale = [];
  for (const [tg, names] of targetedBy) if (!unitSet.has(tg)) stale.push(`${tg} (from ${names.join(', ')})`);

  console.log(`\n${units.length - gaps.length}/${units.length} instruction files have a test.`);
  if (gaps.length) {
    console.log(`\n${gaps.length} gap(s) — write a task in evals/tasks/<name>/test.yaml with`);
    console.log('metadata.targets pointing at the file, to make it testable:');
    for (const g of gaps) console.log(`  - ${g}`);
  }
  if (stale.length) {
    console.log('\nStale targets (task points at a missing file):');
    for (const s of stale) console.log(`  - ${s}`);
  }
  console.log('');
}

// ---- main -----------------------------------------------------------------

function ablate(target) {
  const t = norm(target);
  const safe = t.replace(/[^a-z0-9]+/gi, '-');
  runComparison({
    description: `ablate ${t}`,
    variant: { label: `ablate-${t}`, config: { stripPaths: [t] } },
    tasks: tasksTargeting(t),
    outName: `ablate-${safe}`,
    otherName: `ablate ${t}`,
  });
}

const arg = process.argv[2];
if (!arg || arg === '--coverage') {
  coverage();
} else if (arg === '--all') {
  const all = [...new Set(allTasks().flatMap((t) => t.targets))].sort();
  if (all.length === 0) console.log('\n[ablate] No tasks declare metadata.targets yet.\n');
  console.log(`\n[ablate] Ablating ${all.length} file(s), one full eval each — slow and costs credits.\n`);
  for (const t of all) ablate(t);
} else {
  ablate(arg);
}
