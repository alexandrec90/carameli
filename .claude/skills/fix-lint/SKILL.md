---
name: fix-lint
# No disable-model-invocation: this skill is invoked programmatically by /fix-all
# via the Skill tool. See .claude/rules/authoring.md (orchestrated sub-skill exception).
description: 'Fixes lint errors collected in logs/lint-errors.log.'
---

# Skill: Fix Lint Errors

Fix the lint errors recorded in `logs/lint-errors.log`. That log is written by the lint
runner (`scripts/lint-all.py`) whenever the lint suite runs — **this skill never runs the
full lint suite itself.** It reads the log, fixes the implicated source, and rechecks only
the specific linter on the changed file(s) to confirm.

> **No Docker stack needed.** Linters run on the host toolchain — `ruff`/`mypy` in the venv,
> `eslint`/`tsc` via `npm --prefix frontend`. Lint fixes are plain source edits, so they
> can't break the container stack (no `/fix-docker` handoff applies here). If the toolchain
> isn't available, apply the fixes, stamp the log, and tell the user to re-run the lint suite
> to verify.

## Step 1 — Read the log + known fixes (first action, in parallel)

Read `logs/lint-errors.log` and `.claude/skills/fix-lint/known-fixes.md` in a **single
parallel call** before anything else. Then act on the log's state:

| Log state | Action |
|---|---|
| Empty | Lint is green — stop. |
| Last line is `--- ADDRESSED`, or file missing | Stale/ungenerated — tell the user to re-run the lint run (`scripts/lint-all.py`), then stop. Don't run the suite yourself. |
| Non-empty, last line ≠ `--- ADDRESSED` | Fresh — proceed below. |

Errors are grouped under `# toolname` sections (`# ruff-check`, `# ruff-format`, `# mypy`,
`# eslint`, `# tsc`, `# bandit`, …) as `file:line:col: CODE message`. Bandit findings appear
as `>> Issue: [CODE] message` + a `Location: file:line:col` pair — treat `Location:` as the anchor.

**Log-quality gate (mandatory).** If a section has errors but no self-locating `file:line`
line (or its body is only "exit code indicated failure but no parseable error lines…"), the
cause is invisible. Don't guess-fix. Widen the filter in `scripts/diagnostics.py` (the
`LINT_SECTIONS` keep-functions) or the tool's output in the runner named on the `# source:`
header, update `scripts/hooks/tests/test_diagnostics.py` in the same edit, then tell the user
to regenerate the log.

**Noise gate (mandatory — the inverse).** A section must hold *only* errors worth fixing. If one
tool's section is flooded by a single file that shouldn't be linted at all — e.g. hundreds of
markdownlint errors from a captured transcript under `artifacts/transcripts/` — that noise
buries real source
errors in the sections below it. Don't start fixing the flood. **Narrow** the runner's target in
the script named on the `# source:` header (e.g. add the offending path to markdownlint's
`--ignore` set in `scripts/lint-all.py`, or exclude it in `.markdownlint.json`), or **tighten**
the section's keep-filter in `scripts/diagnostics.py` (`LINT_SECTIONS`) when the noise is per-line
rather than per-file. Update `scripts/hooks/tests/test_diagnostics.py` in the same edit, then tell
the user to regenerate the log.

**Known-fix short-circuit (mandatory).** For each error, if any `known-fixes.md` pattern
substring matches the rule code or message, apply that documented fix immediately — no extra
reads, no re-derivation. Bump the row's **Hits** and set **Last used** to today.

## Step 2 — Fix the remaining errors

For each error with no known-fix match, open the file and apply the **smallest** fix — no
refactors, no unrelated cleanup. Preserve existing `logger.*` calls; add any missing per
`.claude/rules/logging.md`. If a fix needs a DB schema change, stop and use `/add-db-model`.

**Never suppress, never relax (hard rule).** Fix the source, not the check. Do not add
suppression markers (`# noqa`, `# type: ignore`, `# nosec`, `eslint-disable*`,
`@ts-expect-error`), loosen a type to `Any`/`cast` just to satisfy mypy, or weaken/disable a
rule in a linter config to make an error disappear. A suppression is allowed only when the
tool itself is wrong — a documented false positive (upstream issue, rule docs) — cited in
the report and scoped to the narrowest form (single line, specific rule code). Excluding a
file that shouldn't be linted at all is the noise gate's job (Step 1) and goes through the
producing script plus a log regeneration — never a quiet config edit here. Project-wide rule
changes are the user's call: report them as an option, don't apply them.

After applying at least one fix, append `--- ADDRESSED` to `logs/lint-errors.log`. Add a
`known-fixes.md` row for any new pattern likely to recur (Error pattern / Root cause / Fix /
Hits `1` / Last used / Added — dates today); prune zero-hit rows older than 90 days.

## Step 3 — Recheck, then report

Recheck **only the changed file with the specific linter that flagged it** — never the full
suite (the lint runner owns that). All run on the host toolchain except migration drift:

- ruff: `ruff check <file>` (or `ruff format --check <file>`)
- mypy: `mypy <file>`
- eslint: `npm --prefix frontend run lint:eslint -- <file>`
- tsc: `npm --prefix frontend run lint:types` (whole-project — tsc can't scope to one file)
- migration drift (alembic): `docker compose exec -T app alembic check` (the one Docker-backed recheck)

If a recheck still flags it, fix and recheck again — up to **4 rounds**, stopping early if a
round ends with the same errors it began with (report the holdouts rather than spinning). If
the toolchain isn't available, skip the recheck: report the fixes you applied and tell the
user to re-run the lint suite to verify.

Then report: which errors were fixed (file, line, what changed) and, for anything not fixed,
the evidence and 2–3 concrete options with a recommendation — never a bare "skipped".
