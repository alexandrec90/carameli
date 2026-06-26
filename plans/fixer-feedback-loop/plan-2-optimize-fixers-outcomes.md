# Plan 2 — optimize-fixers consumes outcome data

**Depends on:** Plan 1 (merged). **Parallel with:** Plan 3.
**Read first:** `plans/fixer-feedback-loop/README.md` (data contract).

## Goal

Make `/optimize-fixers` reason about whether fixes actually *worked*, not just whether
the fixer was *active*. Today it can add a known-fix row for any error that recurred
(check 3b) — but a recurring error often means the *last* fix didn't hold, so blindly
codifying another guess makes it worse. Use the Plan-1 outcome data to:

1. **Gate 3b** — don't auto-add a known-fix row for a skill whose fixes don't stick.
2. **Add check 3g (ineffective-fix escalation)** — when an error is `recurring`, flag it
   for human/promptfoo review instead of adding another known-fix row.

## Blocking design decision (resolve before coding)

optimize-fixers Hard Rule 5 caps reads at 3 (SKILL.md + known-fixes.md + profile). The
ledger holds per-signature status, but reading it would be a 4th read. **Therefore the
per-signature recurring info must be surfaced into the profile.** Do this in
`archive-session.py` (Plan 1's module), not by relaxing Hard Rule 5:

### Change A — surface recurring signatures into the profile

File: `scripts/hooks/archive-session.py`

- Extend `outcome_counts(ledger)` (or add `recurring_signatures(ledger)`) to also return,
  per skill, the list of signatures whose `status == "recurring"` (cap at ~10, newest by
  `last_seen`).
- In `update_profile`, when `skill in outcomes`, also write
  `p["recurring_errors"] = [...]` (list of signature strings). Omit when empty.
- Tests: extend `scripts/hooks/tests/test_archive_session_outcomes.py` — a ledger with a
  recurring entry yields it in `recurring_errors`; a profile without recurring entries
  omits the field.

## Changes to the skill

File: `.claude/skills/optimize-fixers/SKILL.md`

### Change B — Step 1 delta

Add to the "Compute the delta" list:

```
- **Outcomes**: `current.fix_outcomes` (fixed/recurring/open/success_rate) and
  `current.recurring_errors` vs the snapshot equivalents (treat missing as absent).
```

### Change C — gate 3b

In **3b. New known-fixes entries**, prepend a guard:

> Before adding any row, check `fix_outcomes.success_rate` for this skill. If it is
> **< 0.5** with at least 3 resolved-or-open entries, the skill's fixes are not holding —
> do **not** add new known-fix rows (they would codify unreliable fixes). Instead handle
> the recurring errors under 3g and note the low success rate in the report.

### Change D — new check 3g

Add after 3f:

```markdown
### 3g. Ineffective-fix escalation

`recurring_errors` lists signatures that came back after being marked fixed — the
existing guidance is not solving them. For each recurring signature:

- If it matches an existing `known-fixes.md` row, the codified fix is wrong or
  incomplete. Mark that row's **Fix** column with `(recurring — needs review)` and do
  NOT silently overwrite it.
- If it has no row, do NOT add a naive one. Note it in the report under "Escalate to
  promptfoo" with the signature and the skill — this is the hand-off point to Plan 3/4.

Never fabricate a corrected fix for a recurring error from the profile alone.
```

### Change E — report section

Add a bullet: `Recurring errors escalated (signature, skill)`.

## Eval task (mandatory)

Create `evals/tasks/optimize-fixers-outcomes/` mirroring the existing
`evals/tasks/optimize-fixers-cost/` (read that first — same provider/threshold pattern).

- `setup.cjs`: seed a throwaway `fix-eval-fixture` skill (clean on 3a–3f) plus a
  current/snapshot profile where `fix_outcomes.success_rate` is low (e.g. 0.33) and
  `recurring_errors` lists one signature that **already has a known-fixes.md row**. Make
  3a–3f produce nothing, so the only action is 3g.
- `verify.cjs`: pass when the fixture's `known-fixes.md` row was annotated
  `(recurring — needs review)` AND no brand-new naive row was added. Compare against the
  seeded original (the fixture is untracked — git-diff doesn't apply; see the cost task's
  verify.cjs).
- `test.yaml`: `targets: [.claude/skills/optimize-fixers]`,
  `providers: [with-instructions, baseline-no-instructions]`, threshold 0.7, the same
  three asserts (verifyPassed weight 3, madeAnEdit 1, readsBeforeFirstEdit ≤8).

## Acceptance criteria

- [ ] `recurring_errors` surfaced into the profile, with tests.
- [ ] optimize-fixers gates 3b on success_rate and adds 3g.
- [ ] `npm run eval:coverage` still shows optimize-fixers covered; new task added.
- [ ] Full hook suite green: `pytest scripts/hooks/tests/ -q`.
- [ ] `ruff`, `mypy`, `py_compile` clean on the changed Python.
- [ ] SKILL.md stays < 500 lines (`.claude/rules/authoring.md`).

## Watch out for

- Don't relax Hard Rule 5 — surface to the profile instead (Change A).
- `success_rate` low with < 3 entries is noise; require the entry count gate.
- Remember the AGENTS mirror is generated — only edit `.claude/`, never `.agents/`.
