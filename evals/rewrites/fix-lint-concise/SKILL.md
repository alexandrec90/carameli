---
name: fix-lint
disable-model-invocation: true
description: 'Fixes lint errors collected in logs/lint-errors.log.'
---

# Skill: Fix Lint Errors

> **Local session only.** Reads a log artifact written by a PS1 script on the host.

Candidate rewrite of `.claude/skills/fix-lint/SKILL.md` — a leaner version kept for
A/B testing via `npm run eval:rewrite`. Not loaded as a skill (skills load from
`.claude/skills/*/SKILL.md` only). If it wins on accuracy + tokens, promote it.

## Step 1 — Read log + known fixes (parallel, first action)

Read `logs/lint-errors.log` and `.claude/skills/fix-lint/known-fixes.md` in a single
parallel call. If the log is missing/empty, regenerate it (re-run the lint suite; CI: push)
and stop. If its last line is `--- ADDRESSED`, regenerate it first and stop.

**Known-fix short-circuit (mandatory):** for each error, if any `known-fixes.md`
pattern substring matches the rule code or message, apply that fix immediately — no
extra reads. Bump the row's **Hits** and set **Last used** to today.

## Step 2 — Fix unmatched errors

Errors are listed under `# toolname` sections as `file:line:col: CODE message`. For
each, open the file and apply the **smallest** fix — no refactors, no unrelated
cleanup. Preserve existing `logger.*` calls. If a fix needs a DB schema change, stop
and use `/add-db-model`.

If an error has no `file:line` (not self-locating), the log is low quality: fix the
producing lint filter (named on the log's `# source:` header) and stop instead of guessing.

After applying at least one fix, append `--- ADDRESSED` to `logs/lint-errors.log`. Add
a `known-fixes.md` row for any new pattern likely to recur; prune zero-hit rows older
than 90 days.

## Step 3 — Report

List what was fixed (file, line, change) and what was skipped. After a fix you may run
the single linter on the changed file (e.g. `ruff check <file>`) to confirm — never
re-run the full **Lint: Everything** task.
