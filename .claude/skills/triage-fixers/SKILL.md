---
name: triage-fixers
disable-model-invocation: true
description: 'Read-only triage. Turns the Stop-hook fixer profile + error ledger into a ranked "escalate to promptfoo" list so eval credits are spent on the runs that matter. Produces a report only — makes no edits to skills or source.'
argument-hint: '"all" | "<skill>" -- scope to all fixers (default) or one fix-* skill'
---

# Skill: Triage Fixer Skills

Reads the rolling profile (`logs/agent/skills-profile.json`) and the error ledger
(`logs/agent/error-ledger.json`) built by the Stop hook, then ranks `fix-*` skills by
how much they'd benefit from an expensive **promptfoo fixture** run. This is the
"profile as triage, promptfoo as scalpel" layer: it spends cheap analysis to decide
where the costly eval credits go.

**This skill is read-only.** It produces `logs/agent/triage-report.md` and a short
summary to the user. It makes **no** edits to `fix-*` skills, source, or any other
file. Acting on the report (writing fixtures) belongs to Plan 4 / a human.

> **Heaviness is a *prioritization* signal, never a defect verdict.** A high score
> means "worth a closer look with promptfoo," not "this skill is broken." A recurring
> error may be an **environment flake**, not a skill weakness — Plan 4 must confirm via
> the `last_commit` diff before minting a fixture. State this in the report.

---

## Step 1 — Read the two data files

Read these **in parallel** as the first action:

- `logs/agent/skills-profile.json` — per-skill token + outcome stats
- `logs/agent/error-ledger.json` — every error signature and its `status`

If the **profile is absent**, tell the user:

> No fixer data yet. Run some fixer skills (`/fix-tests`, `/fix-e2e`, etc.) so the Stop
> hook builds `logs/agent/skills-profile.json` and `logs/agent/error-ledger.json`, then
> re-run `/triage-fixers`.

Then **stop**.

If the **ledger is absent** but the profile exists, proceed using the profile's
`fix_outcomes` / `recurring_errors` only, and note in the report that no ledger was
available (recurrence is then read from `recurring_errors` instead of ledger entries).

**Optional third read (allowed):** if `logs/agent/skills-profile.optimized.json`
exists, read it to compute the *recent churn* delta (Step 2). If it's absent, churn is
treated as 0 — do **not** fabricate it.

### Scope filter

If an argument names a specific skill (e.g. `fix-tests`), score only that skill.
Otherwise score every `fix-*` entry in the profile.

---

## Step 2 — Score each skill

Compute four signals per skill, each normalized to `[0, 1]`, then take the documented
weighted sum. **Never fabricate a score input not present in the data** — if a signal's
source is missing, that signal is `0`, not a guess.

### The four signals

| Signal | Source | Normalized value (0–1) |
| --- | --- | --- |
| **Low success** | `fix_outcomes.success_rate` | `1 - success_rate`. If `fixed+recurring+open == 0` (no outcomes yet) → `0` (no signal, not 1). |
| **Recurrence** | count of ledger entries for this skill with `status == "recurring"` (fall back to `len(recurring_errors)` if no ledger) | `min(recurring_count / 3, 1.0)` — 3+ recurring saturates. |
| **Cost** | `total_output_tokens / invocations` (mean output per run) | `mean_output / max_mean_output` across the in-scope skills. **Output tokens only.** |
| **Churn** | `invocations - snapshot.invocations` (delta since last optimization) | `delta / max_delta` across the in-scope skills; `0` if no snapshot. |

> ⚠️ **Cost caveat (carry it into the report).** Per-segment `input` / `cache_read`
> tokens reflect the **ambient session context**, not the skill's own cost — never
> score on them. Only `total_output_tokens` and its **trend** (`tokens_history`) are
> controllable signals. If `tokens_history` shows a clear upward trend across recent
> runs, note it as a tie-breaker in the reasons column — but the numeric cost signal is
> always output-tokens-per-run.

### The formula (reproducible — weights written out)

```
priority = 0.35 * low_success
         + 0.30 * recurrence
         + 0.20 * cost
         + 0.15 * churn
```

Weights sum to `1.0`, so `priority ∈ [0, 1]`. Round to 2 decimals in the report. The
relative normalizations (cost, churn) are computed **within the current in-scope set**,
so the ranking is comparable across a single run, not across time.

### Rank signatures within each skill

For each skill, list the specific error signatures worth a fixture, ordered:

1. **Recurring first** — ledger entries with `status == "recurring"` (these came back
   after a fix; highest fixture value).
2. **Then high-frequency** — remaining signatures from `error_patterns` by descending
   count (and ledger `open` entries with the most `attempts`).

For each listed signature, capture its `last_commit` SHA from the ledger entry (`''`
if none) so Plan 4 can `git show <sha>` the fix attempt. Cap at **top 5 signatures**
per skill.

---

## Step 3 — Write the report

Write `logs/agent/triage-report.md` (this is the **only** file this skill writes). Cap
at **top 10 skills**. Use this structure:

```markdown
# Fixer triage report — <YYYY-MM-DD>

> Heaviness is a prioritization signal, not a defect verdict. A recurring error may be
> an environment flake — confirm via each signature's `last_commit` diff before minting
> a promptfoo fixture.

## Ranked skills

| Rank | Skill | Score | Top reasons |
| --- | --- | --- | --- |
| 1 | fix-tests | 0.81 | success 0.25 (3 fixed/9), 2 recurring, output trend ↑ |
| 2 | fix-e2e   | 0.42 | 1 recurring, 12 invocations since snapshot |

## Signatures to escalate

### fix-tests  (score 0.81)
| Signature | Status | Attempts | last_commit |
| --- | --- | --- | --- |
| FAILED tests/unit/test_a.py::test_a - assert 1 == 2 | recurring | 3 | abc123 |
| ... | ... | ... | ... |
```

- The **Top reasons** column cites the concrete numbers that drove the score (success
  rate with counts, recurring count, cost trend, churn) — never a bare adjective.
- Include the cost caveat and the flake caveat in the report body (above).
- If a skill scored `0` on every signal, omit it — the report ranks *candidates*.

---

## Step 4 — Summarize to the user

Report the **top N** skills (default top 3, or all if fewer) with a one-line rationale
each, e.g.:

> 1. **fix-tests** (0.81) — 25% success, 2 recurring signatures; best fixture candidate.
> 2. **fix-e2e** (0.42) — one recurring route-typo signature, high recent churn.

Then point the user at `logs/agent/triage-report.md` for the full table and remind them
this is triage only — Plan 4 / a human confirms each signature before a fixture is cut.

---

## Hard Rules

1. **Read-only.** The only file this skill writes is `logs/agent/triage-report.md`.
   Never edit a `fix-*` skill, `known-fixes.md`, source, or the ledger/profile.
2. **Never fabricate a score input.** A missing signal is `0`, not an estimate. If a
   skill has no outcomes data, say so in the report rather than inventing a success rate.
3. **Caps:** top 10 skills in the report, top 5 signatures per skill.
4. **Output tokens only** for the cost signal — never score on input/cache_read tokens
   (ambient context, per the README caveat).
5. **Minimal reads.** Two data files (profile + ledger), plus the optional snapshot for
   churn. Do not read transcripts, source, or skill configs — everything needed is
   pre-computed in the profile and ledger.
6. **Heaviness ≠ defect.** State in the report that the ranking is prioritization, and
   that a recurring error may be an environment flake to be confirmed via `last_commit`.
