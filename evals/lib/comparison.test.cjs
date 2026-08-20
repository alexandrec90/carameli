/**
 * Unit tests for the comparison-driver plumbing shared by eval:ablate / eval:rewrite
 * / eval:section. Pure logic only — no promptfoo run, no agent spawn — so these are
 * free and fast. Run with `npm run eval:test`.
 *
 * Regression guard: the drivers used to define their own two providers
 * (`with-instructions` + a variant label), which made promptfoo reject every task
 * because the tasks pin `baseline-no-instructions` / `baseline-capable` — providers
 * that config didn't define (ProviderReferenceValidationError). buildProviders now
 * reuses the canonical labels so per-task pins resolve and tiers are preserved.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildProviders } = require('./runner.cjs');
const { groupByTask } = require('./compare.cjs');

// A stand-in for the main config's four providers (labels + tier extraArgs).
const BASE = [
  { id: 'p', label: 'with-instructions', config: { baseRef: 'HEAD', extraArgs: ['--model', 'haiku', '--max-turns', '20'] } },
  { id: 'p', label: 'baseline-no-instructions', config: { baseRef: 'HEAD', stripInstructions: true, extraArgs: ['--model', 'haiku', '--max-turns', '20'] } },
  { id: 'p', label: 'with-instructions-capable', config: { baseRef: 'HEAD', extraArgs: ['--model', 'sonnet', '--max-turns', '40'] } },
  { id: 'p', label: 'baseline-capable', config: { baseRef: 'HEAD', stripInstructions: true, extraArgs: ['--model', 'sonnet', '--max-turns', '40'] } },
];

test('buildProviders keeps all four canonical labels so per-task pins resolve', () => {
  const out = buildProviders(BASE, { stripPaths: ['.claude/skills/fix-tests'] });
  assert.deepEqual(
    out.map((p) => p.label),
    ['with-instructions', 'baseline-no-instructions', 'with-instructions-capable', 'baseline-capable'],
  );
});

test('with-instructions* arms run the full instruction set (no variant transform)', () => {
  const variant = { stripPaths: ['.claude/skills/fix-tests'] };
  const out = buildProviders(BASE, variant);
  for (const label of ['with-instructions', 'with-instructions-capable']) {
    const p = out.find((x) => x.label === label);
    assert.equal(p.config.stripPaths, undefined, `${label} must not carry the variant`);
    assert.equal(p.config.stripInstructions, undefined, `${label} must not strip instructions`);
  }
});

test('baseline-* arms carry the variant transform instead of stripping all', () => {
  const variant = { stripPaths: ['.claude/skills/fix-tests'] };
  const out = buildProviders(BASE, variant);
  for (const label of ['baseline-no-instructions', 'baseline-capable']) {
    const p = out.find((x) => x.label === label);
    assert.deepEqual(p.config.stripPaths, ['.claude/skills/fix-tests'], `${label} must carry the variant`);
    // Repurposed: it ablates one file, it does NOT strip every instruction file.
    assert.equal(p.config.stripInstructions, undefined, `${label} must drop strip-all`);
  }
});

test('tier extraArgs (model + max-turns) are preserved on every arm', () => {
  const out = buildProviders(BASE, { stripPaths: ['x'] });
  assert.deepEqual(out.find((p) => p.label === 'with-instructions').config.extraArgs, ['--model', 'haiku', '--max-turns', '20']);
  assert.deepEqual(out.find((p) => p.label === 'baseline-capable').config.extraArgs, ['--model', 'sonnet', '--max-turns', '40']);
});

test('rewrite/section variants are passed through to baseline arms', () => {
  const replace = buildProviders(BASE, { replacePaths: { a: 'b' } });
  assert.deepEqual(replace.find((p) => p.label === 'baseline-no-instructions').config.replacePaths, { a: 'b' });
  const section = buildProviders(BASE, { stripSections: [{ path: 'f', heading: 'H' }] });
  assert.deepEqual(section.find((p) => p.label === 'baseline-capable').config.stripSections, [{ path: 'f', heading: 'H' }]);
});

test('groupByTask buckets a capable with-instructions-capable row as the "with" arm', () => {
  const data = {
    results: {
      results: [
        { vars: { prompt: '/fix-tests' }, provider: { label: 'with-instructions-capable' }, success: true, score: 1, metadata: {} },
        { vars: { prompt: '/fix-tests' }, provider: { label: 'baseline-capable' }, success: false, score: 0, metadata: {} },
      ],
    },
  };
  const byTask = groupByTask(data);
  const bucket = [...byTask.values()][0];
  assert.equal(bucket.with.length, 1, 'with-instructions-capable must land in the with arm');
  assert.equal(bucket.other.length, 1, 'baseline-capable must land in the other arm');
});
