---
name: update-meta-coding-chart
description: 'Scan the Carameli codebase for meta-coding tools (linters, type checkers, test runners, security scanners, AI config, pre-commit hooks, VS Code tasks, scripts) and update charts/meta coding/meta coding chart.mmd and charts/meta coding/meta coding legend.md if needed.'
argument-hint: 'No arguments needed — always scans and applies any required updates.'
---

# Skill: Update Meta-Coding Chart

Scan the codebase to discover every **meta-coding** tool, diff against the
current chart and legend, and patch both files where they are out of date.

"Meta-coding" means all tooling that surrounds the production code: AI assistants
and their configuration, linters, formatters, type checkers, security scanners,
test runners, pre-commit hooks, VS Code tasks, and build/dev scripts.
It explicitly excludes runtime application components (web framework, database,
job queue, carrier SDKs, etc.) — those belong in the tech stack chart.

---

## Step 1 — Read the Source Files

Read all of the following **in parallel**:

| File | What to look for |
| --- | --- |
| `.pre-commit-config.yaml` | Every hook `id` — each is an enforced meta tool |
| `requirements-dev.txt` | Dev-only Python packages: test runners, linters, security scanners, property-based testing |
| `frontend/package.json` → `devDependencies` | Frontend dev tools: ESLint plugins, type checker, Vitest, Stylelint, cspell, markdownlint, Vite plugins |
| `.vscode/tasks.json` | Every task `label` — maps to a developer workflow action |
| `scripts/` directory listing | Every `.ps1` helper script name and its inline comment header |
| `ruff.toml` | Rule sets selected, line length, per-file overrides |
| `mypy.ini` | Strict mode, plugins enabled, suppressed stub packages |
| `pytest.ini` | asyncio mode, test paths |
| `frontend/eslint.config.js` | ESLint plugins loaded, rules overridden |
| `frontend/stylelint.config.cjs` | Base config, at-rule whitelist |
| `frontend/cspell.config.yaml` | Custom word list, ignored paths |
| `.claude/rules/` directory listing | Rule file names (each file = one enforced convention area) |
| `.claude/skills/` directory listing | Skill names (each subdirectory = one structured workflow) |
| `charts/meta coding/meta coding legend.md` | Current legend rows — the diff target |
| `charts/meta coding/meta coding chart.mmd` | Current Mermaid diagram — the diff target |

---

## Step 2 — Build the Canonical Tool List

From the evidence gathered, create an internal table of **meta-coding components**
with these columns:

| Column | Description |
|---|---|
| `layer` | One of: `AI Assistance`, `Git Commit Gate`, `VS Code Task Runner`, `Python Quality`, `Frontend Quality`, `Testing`, `Build & Runtime` |
| `tool` | Short name (e.g. "Ruff", "detect-secrets", "Hypothesis") |
| `config_file` | Primary config file(s), or `—` if inline/CLI-only |
| `role` | One plain-English sentence describing what the tool does |
| `trigger` | When it runs: `pre-commit`, `VS Code task`, `manual`, `CI`, etc. |
| `evidence` | Which file(s) confirmed it |

### Meta-coding inclusion rules

Include a tool **only if** it satisfies at least one of:

- Appears as a pre-commit hook `id` in `.pre-commit-config.yaml`
- Is a package in `requirements-dev.txt` that is not also in `requirements.txt`
- Is a `devDependencies` entry in `frontend/package.json` used for linting, type
  checking, testing, or documentation quality
- Has a dedicated `.vscode/tasks.json` entry that invokes it
- Has its own config file in the workspace root or `frontend/` (e.g. `ruff.toml`,
  `mypy.ini`, `pytest.ini`, `.markdownlint.json`)
- Is a `.ps1` script under `scripts/` that wraps a quality or security tool
- Is a file or directory under `.claude/rules/` or `.claude/skills/`

### Exclusion list — never include

Regardless of where they appear, **exclude**:

- Runtime application packages: `fastapi`, `sqlalchemy`, `asyncpg`, `arq`,
  `redis`, `telnyx`, `httpx`, `jambonz`, etc.
- VS Code tasks that are purely operational (start Docker stack, open browser,
  apply DB migrations, start ngrok) rather than quality/test related
- Docker, Docker Compose, PostgreSQL, Redis — these are runtime, not meta-coding
- `npm install` / dependency installation tasks — these are setup, not tooling

---

## Step 3 — Diff Against Current Charts

Compare the canonical tool list from Step 2 against the current legend and diagram.

Identify each of the following:

- **Missing legend row** — tool is confirmed but has no row in the legend
- **Stale legend row** — legend row names a tool that no longer appears in any
  source file (e.g. a removed pre-commit hook or deleted script)
- **Wrong description** — the legend role or config is materially inaccurate
- **Missing diagram node** — tool exists in the legend but is absent from the chart
- **Missing diagram edge** — a relationship is implied by source files but not drawn
  (e.g. a new VS Code task that fans out to a quality layer)
- **Wrong diagram grouping** — a node appears in the wrong subgraph

If the diff is empty, print:

```
Meta-coding chart is up to date — no changes needed.
```

and stop.

---

## Step 4 — Apply Updates

### 4a — Update `charts/meta coding/meta coding legend.md`

Preserve the existing file structure exactly:

```markdown
# Meta-Coding Architecture Legend

> intro paragraph …

---

## <Layer Name>

intro sentence …

| Tool | Config | Role |
|---|---|---|
| **ToolName** | `config.file` | Plain-English description |
…
```

Rules:
- Keep existing rows that are still accurate — do not rewrite them unless the
  description is materially wrong.
- Add new rows in the correct layer section.
- Remove rows for stale tools (no longer present in source files).
- If a whole new layer is needed, add it in logical data-flow order after the
  existing sections.
- Sub-tables (e.g. Claude Rule Files, Claude Skill Workflows) follow the same
  rules: add, remove, or correct rows as needed.

### 4b — Update `charts/meta coding/meta coding chart.mmd`

The diagram uses `flowchart TB`. Preserve all existing Mermaid syntax conventions:

- One `subgraph` block per layer, with a human-readable title
- Node labels use two-line bold format: `["<b>ToolName</b><br/>short descriptor"]`
- Edges use `-->` with a quoted label where the relationship needs clarification
- `direction LR` inside subgraphs that have multiple sibling nodes
- The top-level developer node `dev(["👤 Developer"])` always appears first

When adding a node:
1. Place it inside the correct `subgraph`.
2. Add it on its own line inside the `subgraph` block.
3. If it has a `direction LR` group, add it to that group.
4. Add any edges it needs to/from the `dev` node or task runner nodes.

When removing a node:
1. Delete its definition line inside the `subgraph`.
2. Delete any edge lines that reference its identifier.

When renaming a node (tool was updated, e.g. version bump that changes the label):
1. Update the label text only — keep the Mermaid node identifier stable so
   existing edges don't break.

**Validate** the final diagram mentally: every node must be reachable from the
`dev` node via at least one path.

---

## Step 5 — Report

After applying changes, print a summary in this format:

```
## Meta-Coding Chart Update — YYYY-MM-DD

### Legend changes
  ADDED   Frontend Quality / <ToolName> — <one-line reason>
  REMOVED Python Quality / <ToolName> — no longer in requirements-dev.txt
  UPDATED AI Assistance / Claude Skills — added <SkillName> skill

### Diagram changes
  ADDED   node pc_newlint in "Git Commit Gate" subgraph
  ADDED   edge ts_lint --> py_quality (already present for existing tasks)
  REMOVED node vitest_old (tool renamed)

No changes needed if diff was empty.
```

If both files were already up to date, confirm:

```
Meta-coding chart is up to date — no changes needed.
```
