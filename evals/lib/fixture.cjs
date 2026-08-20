/**
 * Shared helpers for fixer-skill eval tasks (setup.cjs / verify.cjs).
 *
 * Each fixer task seeds the skill's log artifact pointing at a committed broken
 * fixture under evals/fixtures/, then checks that the agent repaired it. These
 * helpers keep every setup/verify tiny and consistent. All paths are repo-relative
 * (forward slashes); they're resolved inside the throwaway worktree the provider
 * passes in.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const abs = (worktree, rel) => path.join(worktree, rel.split('/').join(path.sep));

// Seed a log artifact (creating parent dirs). Used by setup.cjs.
function writeLog(worktree, rel, content) {
  const p = abs(worktree, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

// Read a fixture back after the agent ran. Returns null if absent. Used by verify.cjs.
function readFixture(worktree, rel) {
  try {
    return fs.readFileSync(abs(worktree, rel), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Content-based repair check: passes when the fixture exists, contains every
 * `includes` pattern, and contains none of the `excludes` patterns. Patterns are
 * strings or RegExp. The typical broken-token fix is `excludes: [/broken/], includes: [/fixed/]`.
 */
function fixtureMatches(worktree, rel, { includes = [], excludes = [] } = {}) {
  const text = readFixture(worktree, rel);
  if (text == null) return false;
  const hit = (p) => (p instanceof RegExp ? p.test(text) : text.includes(p));
  return includes.every(hit) && !excludes.some(hit);
}

/**
 * Runtime repair check: runs a `-c` snippet that exits 0 on success. Use when the
 * correct fix is best asserted by behavior rather than text (try the py launcher
 * too, so it works whether `python` or `py` is on PATH).
 */
function runPythonOk(worktree, code) {
  for (const [cmd, args] of [['python', ['-c', code]], ['py', ['-3', '-c', code]]]) {
    const r = spawnSync(cmd, args, { cwd: worktree });
    if (r.error) continue; // interpreter not on PATH — try the next
    return r.status === 0;
  }
  throw new Error('verify: no python interpreter found on PATH');
}

module.exports = { writeLog, readFixture, fixtureMatches, runPythonOk };
