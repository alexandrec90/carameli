# Plan 4 — Auto-generate promptfoo fixtures from outcome triples

**Depends on:** Plan 1 (merged) + Plan 3 (triage report). **Do last.**
**Read first:** `plans/fixer-feedback-loop/README.md` (data contract) and an existing
destructive-template task: `evals/tasks/fix-tests-logic-bug/` (test.yaml + setup.cjs +
verify.cjs) — the output shape this plan produces.

## Goal

Convert a real, triage-flagged `error → fix commit → outcome` triple into a committed
promptfoo eval task, so the eval suite is seeded from **production failures** instead of
hand-picked fixtures. This closes the loop: real recurring errors become regression
guards.

This is the riskiest plan — it mints the very things the optimizer is graded against.
The **Goodhart guardrail (below) is not optional.**

## The Goodhart guardrail (design this first)

- The generator **must not** run `optimize-fixers` or edit any `fix-*` skill. It only
  scaffolds an eval task and stops. Generation and optimization stay in separate runs /
  separate hands.
- Generated tasks are **proposals**: write them to a branch / leave them uncommitted for
  human review. Never auto-merge into the eval suite.
- **Label** every generated task (e.g. `metadata.generated: true` + a comment citing the
  source `last_commit`), so a future optimize loop can be told to exclude generated
  fixtures from "optimize against" decisions — otherwise the skill overfits to synthetic
  cases.
- **Confirm the triple is real before minting.** A `recurring` error may be an
  environment flake. Require: the `last_commit` exists and its `git show` actually touches
  source (not just logs), and the error signature is a code error per
  `.claude/rules/diagnostics.md` (not an environment/tool-missing class). Skip and report
  otherwise.

## Implementation

Prefer a **script** (`scripts/gen-eval-fixture.py`, per `.claude/rules/tooling.md`:
importable pure functions + `scripts/hooks/tests/`-style tests) driven by a thin skill
`.claude/skills/gen-fixer-eval/SKILL.md`, rather than doing it all in skill prose — the
diff-extraction and file-scaffolding are mechanical and deserve unit tests.

Inputs (from `logs/agent/triage-report.md` + `error-ledger.json`):

- the error signature, the owning `fix-*` skill, the `last_commit` SHA.

Steps the script performs:

1. `git show <last_commit>` → the fix diff and the file(s) it changed.
2. Derive the **broken** state = the pre-fix version of those files (`git show <sha>^:path`).
3. Scaffold `evals/tasks/<generated-name>/`:
   - `fixture` (the broken file under `evals/fixtures/`, per the destructive template),
   - `setup.cjs` that seeds the fixer's log artifact with the real error signature,
   - `verify.cjs` that re-runs the relevant check and confirms repair,
   - `test.yaml` with `targets: [.claude/skills/<fixer>]`, the capable providers if the
     bug needs reasoning, `metadata.generated: true`, a `baselinePrompt`.
4. Validate the scaffold parses (YAML loads, cjs `node -c`) but do **not** run the agent
   eval (costs credits).

## Tests

- Unit-test the pure pieces in `scripts/hooks/tests/` (or a sibling `scripts/tests/`):
  diff parsing, pre-fix extraction, name derivation, scaffold contents — using a tiny
  committed git fixture or a mocked `git show`.
- The generated *task itself* is hard to test headless (it generates evals). Per
  `.claude/rules/authoring.md`, if the `gen-fixer-eval` skill can't be evaluated headless,
  document the exclusion + reason in `evals/README.md` rather than shipping a flaky eval.
  A scaffold-structure unit test on the script is the real safety net.

## Acceptance criteria

- [ ] Generator scaffolds a valid destructive-template task from a real commit.
- [ ] Guardrail enforced: no skill edits; generated tasks labeled + left for review;
      flake/environment errors skipped with a reason.
- [ ] Script logic unit-tested; exclusion documented in `evals/README.md` if the skill
      itself isn't headless-testable.
- [ ] `ruff`/`mypy`/`py_compile` clean; generated YAML/cjs validate.

## Watch out for

- Do not commit generated fixtures automatically — human gate.
- Pre-fix extraction fails if the commit touched many files or was squashed — handle the
  multi-file case explicitly or skip with a clear report.
- A generated task that can't discriminate (passes with or without the skill) is worse
  than none — verify the broken fixture actually fails the baseline before proposing it.
