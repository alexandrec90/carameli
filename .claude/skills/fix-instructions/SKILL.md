---
name: fix-instructions
disable-model-invocation: true
description: 'Acts on promptfoo eval results (evals/output/latest.json) to improve the instruction files (CLAUDE.md + .claude/rules + .claude/skills) — strengthening, pruning, or trimming markdown based on the with-instructions vs baseline delta.'
argument-hint: '(no arguments) — reads the latest eval run'
---

# Skill: Fix Instruction Files from Eval Results

A fixer skill whose "bug" is an underperforming instruction file and whose "fix" is
a **markdown edit**, not a code edit. It reads the promptfoo eval artifact written by
`npm run eval` and turns the with-instructions vs baseline delta into concrete edits
to `CLAUDE.md`, `.claude/rules/*`, and `.claude/skills/*`.

This skill is **cross-environment** (Read/Glob/Edit on JSON + markdown only — no PS1,
no Docker), so it runs in local, web, and mobile sessions.

It never runs the eval and never edits code. The loop is:
**you run the eval → this skill edits markdown → you commit → you re-run the eval to confirm.**
(The eval checks out committed `HEAD` into a worktree, so uncommitted instruction edits
aren't measured until committed.)

---

## Step 1 — Read Results, Known Fixes & State (parallel, mandatory first action)

> **MANDATORY FIRST ACTION**: Read these three files in a single parallel call before
> anything else. Skipping this violates the hard rules.

- `evals/output/latest.json` — the eval artifact
- `.claude/skills/fix-instructions/known-fixes.md` — recurring signal → edit map
- `.claude/skills/fix-instructions/state.json` — `{ "lastAddressedEvalId": "..." }`

If `evals/output/latest.json` does not exist or is empty, tell the user:

> No eval results yet. Run the **Eval: Instruction Files (promptfoo)** task (or
> `npm run eval`), then invoke `/fix-instructions`.

Then **stop**.

### Addressed check

If `latest.json.evalId` equals `state.json.lastAddressedEvalId`, these results were
already acted on. Tell the user:

> This eval run was already addressed. Commit the instruction edits, re-run the
> **Eval: Instruction Files (promptfoo)** task, and invoke `/fix-instructions` again
> to act on the new numbers.

Then **stop**. (A fresh eval run gets a new `evalId`, which clears this naturally.)

---

## Step 2 — Build the per-task delta

`latest.json` → `results.results[]`. Group rows by task (use `vars.prompt`). Each task
should have a `with-instructions` row and a `baseline-…` row (match on `provider.label`).
For each pair, compare `metadata`:

| Field | Meaning | Better when |
|---|---|---|
| `verifyPassed` | task-specific correctness check | `true` |
| `toolCalls` | total tool invocations | lower |
| `failedToolCalls` | tool results flagged `is_error` | lower |
| `readsBeforeFirstEdit` | investigation-spiral signal | lower |
| `madeAnEdit` | whether the agent acted | task-dependent |
| `cost` / `tokenUsage` | spend | lower |

The signal you act on is the **delta between the two columns on the same task**, plus
each row's `success` / `score`.

---

## Step 3 — Classify each task, then act

Map every task to exactly one category and apply the smallest markdown edit that
addresses it. Apply edits directly — do not just list recommendations.

### 3a. Instructions underperformed (the rule/skill that should help, didn't)

The `with-instructions` row failed a correctness or efficiency assert that an
instruction file is supposed to enforce (e.g. an import-boundary question still took
many `toolCalls`, or a `/fix-*` skill spiralled / left `verifyPassed: false`).

- Find the instruction file that owns this behavior (the rule named in
  `CLAUDE.md`'s guardrails table, or the invoked skill's `SKILL.md`).
- **Strengthen the weakest link**: add the missing fact, tighten a vague step, or
  promote a soft suggestion to a hard rule. Prefer one sharp imperative over prose.
- If the gap is a recurring **failed-tool-call / shell-thrash** pattern (e.g. the
  agent alternated `Bash` and `PowerShell` and racked up `failedToolCalls` on
  Windows), the missing guidance is *runtime* tool selection — check whether any
  rule steers which shell to use at run time, and add a one-liner if not. (Author it
  per `.claude/rules/authoring.md` — scoped frontmatter, single domain.)

### 3b. No delta — dead weight (pruning candidate)

The `with-instructions` and `baseline` rows are effectively tied (same `success`,
no meaningful drop in `toolCalls` / `readsBeforeFirstEdit`) on a task whose whole
purpose is to exercise a specific rule.

- That rule isn't changing behavior. Per `.claude/rules/authoring.md`, instruction
  files earn their place or get cut.
- **Confirm before deleting a whole rule file** — a single task is weak evidence.
  Trim the specific lines the task targeted, or flag the file as a prune candidate in
  the report and ask. Do not delete a rule wholesale off one tied task.

### 3c. Instructions did worse than baseline (active harm / bloat)

The `baseline` row beat `with-instructions` (fewer tool calls, lower cost, or it
passed where instructions failed).

- The instruction is misleading, over-long, or sends the agent down a wrong path.
- Trim or correct the offending lines. Bias toward **removal** — bloat taxes every
  task, not just this one.

### 3d. Degenerate baseline — don't trust the row

The `baseline` row did no real work (`toolCalls: 0` and `success: false`, typically a
bare `/skill` that couldn't resolve with instructions stripped).

- **Do not edit instructions off this row.** The comparison is invalid.
- Tell the user to add a `baselinePrompt` var to that task's `test.yaml` (the
  plain-English equivalent of the skill) so the baseline becomes a fair comparison,
  then re-run. Do not edit the eval harness yourself unless the user asks.

---

## Step 4 — Update known-fixes & stamp addressed

### Known-fixes table

For any signal you acted on that is **likely to recur**, add/update a row in
`.claude/skills/fix-instructions/known-fixes.md` (same schema as every fixer skill):

| Eval signal (substring) | Root cause | Instruction edit | Hits | Last used | Added |

- On a match with an existing row, bump **Hits** and set **Last used** to today.
- Add a new row only for recurring signals — not one-off tweaks.
- Prune rows where **Hits = 0** and **Added** is more than 90 days ago.

### Stamp addressed

Write `.claude/skills/fix-instructions/state.json` with
`{ "lastAddressedEvalId": "<latest.json evalId>" }` so the next invocation on the same
run short-circuits in Step 1.

---

## Step 5 — Report

State clearly:

- Per task: the category (3a–3d) and the exact markdown edit made (file + what changed).
- Pruning candidates flagged for confirmation (3b) — list them, don't delete silently.
- Any task left untouched because its baseline was degenerate (3d), with the
  `baselinePrompt` suggestion.
- **Next step reminder:**

  > Commit these instruction edits, re-run the **Eval: Instruction Files (promptfoo)**
  > task, and invoke `/fix-instructions` again to confirm the delta moved.

---

## Hard Rules

1. **Edit only instruction markdown** — `CLAUDE.md` (any level), `.claude/rules/*.md`,
   `.claude/skills/*/SKILL.md` and their sibling `.md`. Never edit application code,
   tests, or the `evals/` harness (provider, task yaml, fixtures) off these results.
2. **Reading the three Step-1 files in parallel is the mandatory first action.** Do not
   read application source to "re-derive" what a rule should say — the eval tells you
   which behavior is wrong; fix the markdown that owns it.
3. **Never trust a degenerate baseline** (Step 3d). A `toolCalls: 0` failed baseline is
   an invalid comparison — recommend a `baselinePrompt`, don't edit instructions off it.
4. **Bias toward removal.** Prefer trimming bloat over adding prose. When adding, add
   the shortest imperative that works. Respect `.claude/rules/authoring.md` (conciseness,
   scoped frontmatter, one domain per rule, CLAUDE.md under ~200 lines).
5. **Don't delete a whole rule file off a single tied task.** Trim the targeted lines or
   flag for confirmation (Step 3b).
6. **Never run the eval, and never edit instruction files inside an eval worktree.** Edit
   the live repo; the user commits and re-runs to measure.
7. **Skip a run already stamped** in `state.json` (Step 1 addressed check).
