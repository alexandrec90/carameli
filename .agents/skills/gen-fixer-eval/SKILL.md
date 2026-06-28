---
name: gen-fixer-eval
disable-model-invocation: true
description: 'Scaffolds a promptfoo eval task from a real error -> fix commit -> outcome triple (from the triage report), so the eval suite is seeded from production failures. Generates a PROPOSAL only — it never runs optimize-fixers, never edits a fix-* skill, and never commits. Human review gate required.'
argument-hint: '"<skill> <commit>" or none (uses the top candidate from logs/agent/triage-report.md)'
---

# Skill: Generate a Fixer Eval Fixture

Turns a triage-flagged `error → fix commit → outcome` triple into a committed-style
destructive eval task under `evals/tasks/`, so the eval suite is seeded from **real
production failures** instead of hand-picked fixtures. This closes the fixer feedback
loop: recurring real errors become regression guards.

The mechanical work — `git show` of the fix, pre-fix extraction, file scaffolding,
parse validation — lives in the unit-tested script `scripts/gen-eval-fixture.py`. This
skill only **chooses the candidate** and **runs the script**; it writes no scaffold
prose itself.

> **Needs a git checkout** (the fix commit must be reachable) and `node` for the cjs
> parse check. It does **not** need Docker. It reads `logs/agent/triage-report.md`,
> produced by `/triage-fixers` (Plan 3).

---

## The Goodhart guardrail (non-negotiable)

This skill mints the very things the optimizer is graded against, so:

1. **Generation and optimization stay in separate hands.** This skill **never** runs
   `/optimize-fixers` and **never** edits a `fix-*` skill, its `known-fixes.md`, or any
   source. It scaffolds an eval task and stops.
2. **Generated tasks are proposals.** The script writes them **uncommitted** and labels
   every one `metadata.generated: true` with a comment citing the source commit. **Do
   not `git add`/commit them** — leave the human review gate. A future optimize loop must
   be told to exclude generated fixtures from "optimize against" decisions, or the skill
   overfits to synthetic cases.
3. **Confirm the triple is real before minting.** A `recurring` error may be an
   environment flake. The script refuses (and reports a reason) unless: the commit
   exists, it touches **source** (not just logs/docs), it's a **single** source-file
   change with a derivable pre-fix state, the diff is **discriminating**, and the
   signature is a **code error** (not environment / tool-missing) per
   `.claude/rules/diagnostics.md`. Relay the skip reason — never re-run with a fabricated
   input to force it through.

---

## Step 1 — Pick the candidate triple

**If the user passed `<skill> <commit>`** (and optionally a signature), use those.

**Otherwise**, read `logs/agent/triage-report.md`:

- If it's absent, tell the user to run `/triage-fixers` first, then **stop**:
  > No triage report yet. Run `/triage-fixers` to rank fixers and emit
  > `logs/agent/triage-report.md`, then re-run `/gen-fixer-eval`.
- Take the **top-ranked skill**, and within its "Signatures to escalate" table the
  **top signature with a non-empty `last_commit`** (recurring rows are listed first —
  prefer those). That gives you `skill`, `signature`, and `commit`.
- If every candidate signature has an empty `last_commit` (no fix attempt recorded),
  there is nothing to mint — report that and stop.

State the chosen triple to the user (skill, signature, commit) before running.

---

## Step 2 — Run the generator

Run the script (it does git extraction, scaffolding, and parse validation):

```bash
python scripts/gen-eval-fixture.py --skill <skill> --signature "<signature>" --commit <commit>
```

- Use `--dry-run` first if you want to preview the paths without writing.
- The script prints either the written files (a `Scaffold`) or `SKIP: <reason>` (and
  exits non-zero). **On SKIP, relay the reason verbatim and stop** — the triple isn't a
  safe single-file code fix. Do not edit the script's inputs to bypass a skip.

---

## Step 3 — Report and hand off (no commit)

On success, the script wrote four files under `evals/fixtures/<name>/` and
`evals/tasks/<name>/`. Report to the user:

- the new task name and the broken-file path,
- that it is a **proposal left uncommitted** — they must review the seeded log, the
  broken fixture, and the diff-derived `verify.cjs` assertions before committing,
- that they should confirm it actually discriminates (a task that passes with **and**
  without the skill is worse than none):

  ```bash
  npm run eval:ablate -- .claude/skills/<skill>
  ```

Then **stop**. Do not commit, do not run `/optimize-fixers`, do not edit the targeted
fixer skill.

---

## Hard Rules

1. **Scaffold only.** Never run `/optimize-fixers`, never edit a `fix-*` skill / its
   `known-fixes.md` / source. Generation and optimization are separate runs.
2. **No auto-commit.** Generated tasks stay uncommitted for human review. The label
   `metadata.generated: true` is applied by the script — never strip it.
3. **Honour skips.** If the script reports `SKIP`, relay the reason and stop. Never
   fabricate or alter the signature/commit to force a fixture out of a flake.
4. **One triple per run.** Mint a single candidate, then stop — don't batch-generate.
5. **Read-light.** Read `logs/agent/triage-report.md` (and the script output). You do
   not need to read source or the fix commit yourself — the script handles `git show`.
