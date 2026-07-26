# Plan 3 — Fixer triage report skill

**Depends on:** Plan 1 (merged). **Parallel with:** Plan 2. **Feeds:** Plan 4.
**Read first:** `docs/plans/active/fixer-feedback-loop/README.md` (data contract).

## Goal

A read-only skill that turns the accumulated profile + ledger into a **ranked
"escalate to promptfoo" list**, so expensive eval credits are spent on the runs that
matter most rather than blind sweeps. This is the "profile as triage, promptfoo as
scalpel" layer. It produces a report only — it makes **no edits**.

## The skill

Create `.claude/skills/triage-fixers/SKILL.md` (cross-environment: Glob/Grep/Read/Write
only — no hooks, no Docker). Follow `.claude/rules/authoring.md`:

- Frontmatter: `name: triage-fixers`, `disable-model-invocation: true`, a `description`,
  and an `argument-hint` (`"all" | "<skill>"`).
- Behavior:
  1. Read `logs/agent/skills-profile.json` and `logs/agent/error-ledger.json`. If the
     profile is absent, tell the user to run fixers first, then stop.
  2. For each `fix-*` skill, compute a **priority score** from these signals (all already
     in the contract):
     - **Cost weight** — `avg_tokens` and `total_output_tokens` trend (output only; see
       the ambient-context caveat in the README).
     - **Recurrence** — count of `status == "recurring"` ledger entries for the skill.
     - **Low success** — `1 - fix_outcomes.success_rate`.
     - **Recent churn** — invocations since the snapshot (delta).
  3. Rank skills, and within each, rank the specific error signatures worth a fixture
     (recurring first, then high-frequency from `error_patterns`).
  4. Write `logs/agent/triage-report.md`: a ranked table (skill, score, top reasons, the
     concrete signatures + their `last_commit` SHA so Plan 4 can `git show` the fix).
  5. Report the top N to the user with a one-line rationale each.
- Hard rules: read-only (only writes `logs/agent/triage-report.md`); never fabricate a
  score input not present in the data; cap the report (e.g. top 10 skills, top 5
  signatures each).

Keep the exact scoring formula simple and documented in the SKILL.md (e.g. a weighted
sum with the weights written out) so it's reproducible and reviewable. Heaviness is a
**prioritization** signal, never a defect verdict — state that in the skill.

## Eval task (mandatory)

Create `evals/tasks/triage-fixers/` (read-only skill → simple task; use the Haiku tier).

- `setup.cjs`: seed a profile + ledger with two fixer skills — one clearly higher
  priority (high output-token trend + 2 recurring errors + low success_rate) and one
  clearly low (cheap, all fixed). evals/output and logs are gitignored, so create the
  dirs.
- `verify.cjs`: pass when `logs/agent/triage-report.md` exists, names the high-priority
  skill **above** the low-priority one, and cites at least one of the seeded recurring
  signatures.
- `test.yaml`: `targets: [.claude/skills/triage-fixers]`,
  `providers: [with-instructions, baseline-no-instructions]`,
  `baselinePrompt` = the plain-English triage job, threshold 0.7. Asserts:
  verifyPassed (weight 3), and a spiral guard on reads (≤6 — it should read only the two
  data files).

## Acceptance criteria

- [ ] `triage-fixers` skill created, read-only, writes only `logs/agent/triage-report.md`.
- [ ] Scoring formula written out in the SKILL.md and reproducible.
- [ ] Eval task added; `npm run eval:coverage` shows it covered.
- [ ] SKILL.md < 500 lines, forward-slash paths only.

## Watch out for

- This skill reads the ledger directly (it's not optimize-fixers, so Hard Rule 5 does not
  apply). Fine.
- Don't let it edit anything — it's the triage layer; edits belong to Plan 2 / human.
- Note in the report that a recurring error may be an **environment flake**, not a skill
  weakness — Plan 4 must confirm via the `last_commit` diff before minting a fixture.
