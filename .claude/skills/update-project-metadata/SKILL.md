---
name: update-project-metadata
disable-model-invocation: true
description: 'Audits and refreshes all Claude Code project metadata: root and subdirectory CLAUDE.md files, .claude/rules/, .claudeignore, and settings.local.json permissions. Use after tech stack changes, folder restructures, or new integrations.'
argument-hint: 'No arguments needed — always scans and applies any required updates.'
---

# Skill: Update Project Metadata

Scan the codebase and update all Claude Code metadata files so they accurately
reflect the current project structure, tech stack, and conventions.

---

## Step 1 — Gather Current State

The harness preloads all source-of-truth and metadata files:

Suggested command (run in terminal):
`pwsh -NoProfile -ExecutionPolicy Bypass -File .claude/skills/state-tools/project-snapshot.ps1 -Sections compose,requirements,requirements-dev,frontend-pkg,config-py,pytest,alembic-env,claude-md,frontend-claude-md,tests-claude-md,services-claude-md,rules-list,claudeignore,settings-local`

The `rules-list` section above lists the rule file names. Read each
`.claude/rules/<name>.md` individually (using the list as your manifest) to
check glob accuracy and convention correctness — they are too varied to pre-inject.

Reference — what to look for in each injected section:

### Source-of-truth files

| Section | What to extract |
| --- | --- |
| `docker-compose.yml` | Service names, ports, volumes |
| `requirements.txt` | Python runtime deps |
| `requirements-dev.txt` | Dev/test deps |
| `frontend/package.json` | JS runtime deps, scripts |
| `app/core/config.py` | Env vars and external service references |
| `pytest.ini` | Test runner config |
| `alembic/env.py` | Migration setup |

### Existing metadata files

| Section | Purpose |
| --- | --- |
| `CLAUDE.md` | Root project context — tech stack, architecture, conventions |
| `frontend/CLAUDE.md` | Frontend context for Claude |
| `tests/CLAUDE.md` | Test conventions for Claude |
| `app/services/CLAUDE.md` | Service layer context for Claude |
| `rules-list` | Names of all `.claude/rules/*.md` files — read each individually |
| `.claudeignore` | Context exclusions |
| `.claude/settings.local.json` | Auto-allow permissions |

---

## Step 2 — Scan for Drift

For each metadata target, check whether the current codebase has diverged:

### 2a — Root `CLAUDE.md`

1. Compare the **Tech Stack** table against `requirements.txt`, `frontend/package.json`,
   and `docker-compose.yml`. Flag rows that name a tech no longer in use or miss a
   new runtime dependency.
2. Compare the **Local Development** commands against `docker-compose.yml` service
   names and `scripts/*.ps1`. Flag stale commands.
3. Compare the **VanillaLand Reference** mapping table against the actual files in
   `app/services/providers/`, `app/api/`, and `app/models/`. Flag new Carameli
   modules that have no VanillaLand mapping row (or stale rows pointing to removed code).
4. Compare the **Front-End** section against `frontend/package.json` and `frontend/src/`
   directory structure. Flag stale layout trees or missing directories.

### 2b — Subdirectory CLAUDE.md files

For each of `frontend/`, `tests/`, `app/services/`:

1. List the actual directory contents (`ls`, `glob`).
2. Compare against what the CLAUDE.md describes.
3. Flag: new directories/files not mentioned, removed items still listed,
   changed patterns (e.g., new test framework, new build tool, new service files).
4. Also check if any **new** subdirectories deserve their own CLAUDE.md
   (threshold: 5+ files with a distinct concern not covered by an existing one).

### 2c — Rules files

For each `.claude/rules/*.md`:

1. Check that every glob in `paths:` still matches at least one file.
2. Check that the conventions described still match the code (spot-check 2-3 files
   per rule).
3. Flag rules with stale paths or inaccurate conventions.

Also scan for **gaps**: directories or file patterns with 5+ files that have no
covering rule and exhibit a consistent convention worth documenting.

### 2d — `.claudeignore`

1. Check that every pattern still matches files that exist.
2. Look for new large/generated tracked files that waste context:
   - Lock files, generated bundles, binary blobs, config files with no code logic.
3. Remove patterns for paths that no longer exist.

### 2e — `settings.local.json` permissions

1. List the current `allow` entries.
2. Check for commonly used commands in `scripts/*.ps1`, `package.json` scripts,
   and `Makefile` (if any) that are not yet auto-allowed.
3. Check for stale entries that reference tools no longer in use.

---

## Step 3 — Report Drift

If nothing is stale, print:

```text
All project metadata is up to date — no changes needed.
```

and stop.

Otherwise, print a summary table:

```text
## Metadata Drift Report

| File | Issue | Detail |
|---|---|---|
| frontend/CLAUDE.md | Stale | Lists vitest but tests moved to playwright |
| .claude/rules/webhooks.md | Missing path | New webhook file app/api/webhooks/recording.py not covered |
| .claudeignore | Missing | New generated file charts/output.svg should be excluded |
| settings.local.json | Missing | npm run lint used frequently but not auto-allowed |
```

---

## Step 4 — Apply Updates

For each item in the drift report:

### Root `CLAUDE.md`

- Update the Tech Stack table, Local Development commands, VanillaLand mapping, and
  Front-End section to match current source-of-truth files.
- Keep the same structure, tone, and table format.

### Subdirectory CLAUDE.md files

- Edit each file to reflect current state. Keep the same structure and tone.
- If a new subdirectory warrants a CLAUDE.md, create one following the existing format.

### Rules files

- Update stale `paths:` globs to match current file locations.
- Update convention descriptions that no longer match the code.
- Create new rule files for identified gaps (follow `.claude/rules/authoring.md`
  conventions: YAML frontmatter, focused single-domain).

### `.claudeignore`

- Add patterns for newly identified noise files.
- Remove patterns for files/directories that no longer exist.

### `settings.local.json`

- Add new auto-allow entries for frequently used commands.
- Remove entries for tools no longer in use.

---

## Step 5 — Final Report

```text
## Metadata Update — YYYY-MM-DD

### Changes Applied

| File | Action | Detail |
|---|---|---|
| frontend/CLAUDE.md | Updated | Added Playwright section, removed vitest reference |
| .claude/rules/webhooks.md | Updated | Added recording.py to paths glob |
| .claudeignore | Added pattern | charts/output.svg |
| settings.local.json | Added entry | Bash(npm run lint:*) |

### Already Up to Date
(list files that needed no changes)
```
