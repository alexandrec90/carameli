---
name: update-skills-chart
description: 'Scan the Carameli skill catalog and built-in skills, then update charts/skills/skills chart.md if any skills were added, removed, or changed.'
argument-hint: 'No arguments needed — always scans and applies any required updates.'
---

# Skill: Update Skills Chart

Scan the project's `.claude/skills/` directory and the built-in skill list, diff
against the current `charts/skills/skills chart.md`, and patch the chart where it
is out of date.

---

## Step 1 — Read the Source Files

Read all of the following **in parallel**:

| File / Location | What to look for |
| --- | --- |
| `.claude/skills/` directory listing | Every subdirectory name — each is a project skill |
| Each `.claude/skills/<name>/SKILL.md` | Frontmatter `name`, `description`; step count; whether it reads, writes, greps, or spawns agents |
| `charts/skills/skills chart.md` | Current chart rows — the diff target |

Also note the built-in / system skills visible in the system-reminder skill list
that are **not** project-specific (e.g. `update-config`, `keybindings-help`,
`claude-api`, `loop`, `schedule`).

---

## Step 2 — Build the Canonical Skill List

From the evidence gathered, create an internal table of **all skills** with these
columns:

| Column | Description |
|---|---|
| `name` | Slash-command name (e.g. `add-endpoint`) |
| `category` | One of: Scaffolding, Test Generation, Fix, Check, Audit, Review, Chart / Metadata Update, Code Maintenance, Built-in / System |
| `what` | One-sentence description |
| `when` | When to call it |
| `frequency` | How often (per commit, per feature, weekly, quarterly, etc.) |
| `cost` | L / M / H based on: L = grep-only or trivial; M = reads/writes several files; H = multi-file generation, multi-agent, or 6+ steps with heavy I/O |
| `evidence` | Which SKILL.md confirmed it |

### Cost estimation rules

| Indicator | Cost |
|---|---|
| Grep-only, no file reads beyond config, 1-3 steps | **L** (~2-5k tokens) |
| Reads/writes several source files, 4-6 steps | **M** (~10-30k tokens) |
| Multi-file code generation, spawns sub-agents, 6+ steps, or state.json workflow | **H** (~40-80k+ tokens) |

---

## Step 3 — Diff Against Current Chart

Compare the canonical skill list from Step 2 against every row in the current
`charts/skills/skills chart.md`.

Identify:

- **Missing skill** — skill exists in `.claude/skills/` but has no chart row
- **Stale skill** — chart row names a skill whose directory no longer exists
- **Wrong description** — the "What It Does" cell is materially inaccurate vs the SKILL.md
- **Wrong category** — skill is listed in the wrong section
- **Wrong cost** — cost tier doesn't match the step/I/O analysis
- **Missing from workflows** — a skill that should appear in the Recommended Workflows section but doesn't

If the diff is empty, print:

```text
Skills chart is up to date — no changes needed.
```

and stop.

---

## Step 4 — Apply Updates

### 4a — Update skill rows

Edit `charts/skills/skills chart.md` following these rules:

- Keep existing rows that are still accurate — do not rewrite them.
- Add new rows in the correct category section, matching the existing table columns for that section.
- Remove rows for stale skills (directory deleted).
- If a skill doesn't fit any existing category, add a new section in logical order before the "Built-in / System Skills" section (which always comes last).
- Update the `> Last updated:` date at the top to today's date.

### 4b — Update Recommended Workflows

Review the Recommended Workflows section at the bottom:

- Add any new skill that has a natural home in one of the workflow tiers.
- Remove any skill that no longer exists.
- Do not restructure the workflow tiers unless a new tier is clearly needed.

---

## Step 5 — Report

After applying updates, print:

```text
## Skills Chart Update — YYYY-MM-DD

### Changes Applied

| Type | Skill | Detail |
|---|---|---|
| Added row | update-skills-chart | Chart / Metadata section — self-updating skill catalog |
| Removed row | ... | Skill directory no longer exists |
| Updated row | ... | Description corrected to match SKILL.md |

### No Changes Needed
(list skills that were already correct)
```

If no changes were made (diff was empty), confirm with the "up to date" message
from Step 3.
