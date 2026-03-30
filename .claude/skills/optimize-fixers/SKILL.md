---
name: optimize-fixers
description: 'Analyzes agent session data to optimize fix-* skill configurations. Use after accumulating several fixer skill invocations to tune investigation budgets, populate known-fixes tables, and update where-to-look hints.'
argument-hint: '"fix-tests" | "fix-e2e" | "all" -- scope to one skill or all fixers (default: all)'
---

# Skill: Optimize Fixer Skills

Reads the rolling profile built by the Stop hook (`logs/agent/skills-profile.json`)
and optimizes `fix-*` skill configurations based on **new data since the last
optimization run**.

---

## Step 1 -- Read Profile & Snapshot

Read these files **in parallel**:

- `logs/agent/skills-profile.json` (current profile)
- `logs/agent/skills-profile.optimized.json` (snapshot from last optimization run)
- `.claude/rules/authoring.md` (fixer conventions reference)

If the current profile does not exist, tell the user:

> No session data yet. Run some fixer skills (`/fix-tests`, `/fix-e2e`, etc.) and
> the Stop hook will build the profile automatically. Then re-run `/optimize-fixers`.

Then **stop**.

If the snapshot does not exist, treat everything in the profile as new data (first
optimization run).

### Compute the delta

For each skill entry, compare the current profile against the snapshot:

- **New invocations**: `current.invocations - snapshot.invocations` (0 if not in snapshot)
- **New error patterns**: entries in `current.error_patterns` that either do not exist
  in the snapshot or have a higher count
- **Changed budget recommendation**: `current.budget_recommendation` vs snapshot
- **Changed files_read_freq**: files whose count increased or are new
- **Changed known_fixes_checked**: compliance ratio may have shifted

If a skill has **zero new invocations** since the snapshot, skip it entirely --
there is nothing new to optimize.

### Scope filter

If an argument names a specific skill (e.g., `fix-tests`), only optimize that skill.
Otherwise optimize all `fix-*` entries in the profile that have new data.

### Data sufficiency check

For each skill in scope, check its total `invocations` count. If fewer than 3, skip
it and note: "Not enough data for `<skill>` (N invocations, need 3+)."

---

## Step 2 -- Read Current Skill Configs

For each skill in scope with sufficient new data, read **in parallel**:

- `.claude/skills/<skill>/SKILL.md`
- `.claude/skills/<skill>/known-fixes.md`

---

## Step 3 -- Analyze & Apply

For each skill, run these checks using **only the delta** (new data since last
optimization). Apply fixes directly -- do not just list recommendations.

### 3a. Known-fixes compliance

Check the profile field `known_fixes_checked` vs `invocations`.

- If `known_fixes_checked < invocations`: the model sometimes skips the known-fixes
  lookup. Check that SKILL.md has the mandatory-first matching language and hard rule
  from the authoring conventions. If missing, add it.

### 3b. New known-fixes entries

For each entry in the **delta** error patterns with a current count >= 2:

1. Check if any existing row in `known-fixes.md` contains a substring match
2. If no match exists, this is a **gap** -- the same error recurred without a
   known-fix shortcut

For each gap:

- Use the error snippet as the **Error pattern**
- Infer the **Root cause** from the snippet and the `files_edited_freq` data
  (which files were edited most often alongside this error?)
- Infer the **Fix** from the same data
- If you cannot confidently infer root cause and fix, add the row with
  `(needs manual review)` in those columns -- a placeholder is better than nothing
- Set **Hits** to `0`, **Last used** to `--`, **Added** to today's date

### 3c. Investigation budget tuning

1. Extract the current budget from SKILL.md (look for "hard cap of N file reads"
   or similar phrasing)
2. Compare with the profile's `budget_recommendation` (p90 of actual reads)

Rules:

- If recommendation > current budget + 2: the budget is too tight, increase it
- If recommendation < current budget - 3: the budget is too loose, decrease it
- Otherwise: leave it alone (small differences are noise)
- Never set a budget below 3

### 3d. Where-to-look table updates

Read the "Where to look by fix hint" table in SKILL.md (if one exists).

From **delta** `files_read_freq`, find files read in >= 30% of invocations that are
NOT mentioned in the table. These are frequently needed but undocumented.

Only apply if you can clearly map the file to an existing fix-hint keyword. If not,
note it in the report but do not modify the table.

### 3e. Stale known-fixes pruning

Check `known-fixes.md` for rows where **Hits = 0** and **Added** is more than
90 days before today. Delete those rows.

---

## Step 4 -- Save Snapshot & Report

### Save snapshot

After all changes are applied, **copy** the current `logs/agent/skills-profile.json`
to `logs/agent/skills-profile.optimized.json` using the Write tool. This marks the
current profile state as "optimized" so the next run only processes new data.

### Report

Summarize what was changed per skill:

- Known-fixes entries added (pattern, root cause)
- Budget adjusted (old value -> new value, with p90 justification)
- Where-to-look additions
- Stale entries pruned
- Compliance issues fixed
- Skills skipped (no new data / insufficient data)

---

## Hard Rules

1. Only modify `fix-*` skills -- never touch other skill types.
2. Never delete known-fixes entries that have **Hits > 0** -- only prune
   zero-hit entries older than 90 days.
3. Budget changes must be justified by the `budget_recommendation` field --
   never adjust based on guesswork.
4. If error pattern inference is uncertain, use `(needs manual review)` --
   never fabricate root causes.
5. Do not read full transcripts or session summaries -- the profile has all
   the data you need. Keep token usage minimal.
6. Maximum 3 file reads per skill (SKILL.md + known-fixes.md + profile).
   All data-driven decisions come from the pre-computed profile.
7. **Always save the snapshot** after applying changes. Skipping this causes
   the next run to re-process stale data and duplicate work.
8. **Skip skills with zero new invocations** since the snapshot -- there is
   nothing new to act on.
