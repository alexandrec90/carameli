---
name: update-tech-stack-chart
description: 'Scan the Carameli codebase for runtime tech components and update charts/tech stack/tech stack legend.md and charts/tech stack/tech stack chart.mmd if needed. Excludes meta/tooling software (linters, AI tools, formatters, test runners, etc.).'
argument-hint: 'No arguments needed — always scans and applies any required updates.'
---

# Skill: Update Tech Stack Chart

Scan the codebase to discover every **runtime** tech component, diff against the
current chart and legend, and patch both files where they are out of date.

"Runtime" means software that must be running or reachable for the **product** to
function in production. It explicitly excludes dev/meta tooling: linters, type
checkers, test runners, formatters, AI coding tools, CI/CD pipelines, etc.

---

## Step 1 — Read the Source Files

Read all of the following **in parallel**:

| File | What to look for |
| --- | --- |
| `docker-compose.yml` | Every service block (`services:`) — each is a runtime component |
| `requirements.txt` | Runtime Python packages: web framework, ORM, async driver, job queue, Redis client, HTTP client, auth libs |
| `frontend/package.json` | Runtime JS packages: framework (`react`, `three`, etc.), bundler (`vite`) |
| `CLAUDE.md` | Tech stack table and project layout — use as authoritative ground truth for component roles |
| `app/core/config.py` | Env-var names that reveal external services (S3, Redis, Telnyx, Jambonz endpoints, etc.) |
| `charts/tech stack/tech stack legend.md` | Current legend rows — the diff target |
| `charts/tech stack/tech stack chart.mmd` | Current Mermaid diagram — the diff target |

---

## Step 2 — Build the Canonical Component List

From the evidence gathered, create an internal table of **runtime components**
with these columns:

| Column | Description |
|---|---|
| `component` | Short layman label (e.g. "Background Jobs") |
| `tech` | Tech name(s), slash-separated if co-deployed (e.g. "ARQ / Redis") |
| `role` | One plain-English sentence a non-engineer can read |
| `diagram_node` | Node label for the Mermaid diagram using two-line format (e.g. `arq[["<b>Background Jobs</b><br/>ARQ"]]`) |
| `diagram_edges` | Which existing nodes it connects to, and in which direction |
| `evidence` | Which file(s) confirmed it |

### Runtime inclusion rules

Include a component **only if** it satisfies at least one of:

- Has its own `services:` block in `docker-compose.yml`
- Is a non-dev Python package in `requirements.txt` that represents an external
  service, runtime protocol, or persistent data store
  (e.g. `sqlalchemy`, `asyncpg`, `arq`, `redis`, `telnyx`, `httpx`)
- Has a dedicated env-var group in `config.py` that points to an external system
- Is explicitly named in the `CLAUDE.md` tech-stack table

### Exclusion list — never include

Regardless of where they appear, **exclude**:

- Linters: `ruff`, `flake8`, `pylint`, `eslint`, `stylelint`, `markdownlint`
- Type checkers: `mypy`, `pyright`, `TypeScript` (the TS compiler itself)
- Test runners and fixtures: `pytest`, `pytest-asyncio`, `vitest`
- Formatters: `black`, `isort`, `prettier`
- Security scanners: `bandit`, `pip-audit`, `semgrep`
- Build / bundler tooling used only at build time (e.g. `@vitejs/plugin-*` dev plugins)
- AI coding tools, IDE extensions, or code generation utilities
- CI/CD orchestration: GitHub Actions, Azure Pipelines

---

## Step 3 — Diff Against Current Charts

Compare the canonical component list from Step 2 against the current legend and
diagram:

- **Missing row** — component is confirmed runtime but has no legend row
- **Stale row** — legend row names a tech that no longer appears in any source file
- **Wrong role** — the legend role description is materially inaccurate
- **Missing node** — component has a legend row but is absent from the Mermaid diagram
- **Missing edge** — a component exists in the diagram but lacks an edge that
  `docker-compose.yml` or `CLAUDE.md` implies (e.g. background job worker reads DB)

If the diff is empty, print:

```text
Tech stack chart is up to date — no changes needed.
```

and stop.

---

## Step 4 — Apply Updates

### 4a — Update `charts/tech stack/tech stack legend.md`

The legend must stay in the same format as the existing file:

```markdown
# Tech Stack Legend

| Component | Tech | Role |
|---|---|---|
| **Frontend** | React / Vite | Web app displayed in users' browsers |
...
```

Rules:

- Keep existing rows that are still accurate — do not rewrite them unless the
  role description is materially wrong.
- Add new rows for missing components.
- Remove rows for stale components (ones no longer present in source files).
- Sort roughly by data flow: Frontend → API → Services → Data Stores → External.

### 4b — Update `charts/tech stack/tech stack chart.mmd`

The diagram must stay valid Mermaid `flowchart LR` syntax. Keep the existing
`subgraph server[...]` grouping for self-hosted components and extend it as needed.

Rules:

- Preserve all existing nodes and edges that are still accurate.
- Add new nodes for missing components using the same naming convention:
  `technology[["Label · Tech"]]` for services/APIs, `technology(("Label · Tech"))`
  for external providers, `technology[("Label · Tech")]` for data stores,
  `technology{"Label · Tech"}` for routing/auth components.
- Add edges using `-->|"description"|` labels.
- Remove nodes/edges for stale components.
- Keep the `subgraph server[...]` block for all self-hosted Docker services.

#### Node label formatting

Every node label must use this two-line format — **never** the `Label · Tech` inline format:

```text
"<b>Label</b><br/>Tech"
```

- The label (plain-English name) goes **first**, wrapped in `<b>...</b>`.
- The tech name goes **below** it, separated by `<br/>`.
- If a node has multiple co-deployed techs, stack them on separate lines with additional `<br/>` entries:

```text
"<b>Call Engine</b><br/>Jambonz<br/>FreeSWITCH"
```

---

## Step 5 — Report

After applying updates, print:

```text
## Tech Stack Chart Update — YYYY-MM-DD

### Changes Applied

| Type | Component | Detail |
|---|---|---|
| Added row | Background Jobs | ARQ / Redis — async task queue for retries |
| Added node | arq | Added to diagram inside server subgraph |
| Added edge | arq → db | Background jobs read/write PostgreSQL |
| Removed row | ... | No longer present in any source file |

### No Changes Needed
(list here any components that were already correct)
```

If no changes were made (diff was empty), confirm with the "up to date" message
from Step 3.
