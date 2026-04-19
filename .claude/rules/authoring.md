---
description: Conventions for authoring .claude rules and skills files
paths:
  - CLAUDE.md
  - "**/CLAUDE.md"
  - .claude/rules/**/*.md
  - .claude/skills/**/SKILL.md
---

# Rule: Rules & Skills Authoring

## CLAUDE.md files

- **No command instructions** — never document `npm run …`, `pwsh …`, or other CLI
  invocations. Commands are discoverable from `package.json`, `tasks.json`, or script
  files; repeating them wastes context window tokens and drifts out of sync.
- **Only record non-obvious configuration** — things that can't be derived by reading
  source files (e.g. proxy routes, port mappings, env var semantics, architectural
  constraints). If Claude can find it in a config file in one read, leave it out.

## Rules (`.claude/rules/`)

Every rule file must include YAML frontmatter so Claude can scope when it applies:

```yaml
---
description: One-line summary of what the rule covers
paths:
  - app/models/**/*.py
  - alembic/**/*.py
---
```

- `description` — brief, specific summary (used to decide relevance).
- `paths` — glob patterns for files the rule applies to. Omit only if the rule is
  truly global (rare).
- Keep rules focused on a single domain — don't mix unrelated conventions in one file.

### Skin rule files

One rule file per skin, named `.claude/rules/skin-<name>.md`.

- **Scope paths to the skin directory only** — never add global frontend paths:

  ```yaml
  paths:
    - frontend/src/skins/<name>/**/*.ts
    - frontend/src/skins/<name>/**/*.tsx
  ```

- **Visual properties as spec tables** — no JSX or CSS code blocks for
  material/animation/layout values. Use markdown tables:

  ```markdown
  | Property | Value | Notes |
  | --- | --- | --- |
  | `roughness` | `0.05` | near-mirror gloss |
  ```

  Structural code (scene hierarchy trees, very short class-name examples) may remain as
  code blocks where the structure itself conveys meaning.

### Security / scoping rules

Cross-cutting security rules (e.g. multi-tenant auth) belong in a scoped rule file, not
in `CLAUDE.md`. Scope them tightly:

```yaml
paths:
  - app/api/**/*.py
```

Then add a one-line pointer in `CLAUDE.md`'s guardrails cross-reference list.
See `.claude/rules/security.md` as the canonical example.

## Skills (`.claude/skills/`)

- Each skill lives in `.claude/skills/<name>/SKILL.md`.
- If the skill generates scripts, those scripts must follow the PowerShell
  conventions in `.claude/rules/tooling.md` (especially `-T` for `docker compose exec`
  and `[Environment]::Exit()`).

### Description field requirements (critical for skill discovery)

The `description` field is how the agent decides which skill to invoke. It must include
both **what** the skill does and **when** to use it:

- Include a "Use when…" clause with concrete triggers
- Maximum 1024 characters

### SKILL.md size limit

Keep `SKILL.md` under **500 lines**. If content exceeds this, apply progressive disclosure:

1. Extract reference material into a sibling file (e.g. `writing-conventions.md`)
2. Keep all references **one level deep** — `SKILL.md` → `reference.md` (never deeper)
3. Add a table of contents to any reference file longer than 100 lines
4. Use forward slashes in all file paths — never backslashes

### Fixer skill conventions (`fix-*`)

Skills that read a log artifact and fix the reported issues must follow these patterns
to prevent investigation spirals (where the model reads dozens of files without ever
making an edit):

#### 1. Known-fixes table (mandatory)

Every `fix-*` skill must have a sibling `known-fixes.md` file with this table format:

```markdown
| Error pattern (substring) | Root cause | Fix | Hits | Last used | Added |
```

- Patterns are plain substrings, not regex
- The skill updates **Hits** and **Last used** on every match
- Rows with **Hits = 0** older than 90 days from **Added** are pruned
- New rows are added only for patterns likely to recur

#### 2. Known-fix matching must be Step 1 — before any investigation

The skill must read the log artifact and `known-fixes.md` **in parallel** as its first
action. For every error that matches a known-fix pattern, the fix is applied immediately
as a one-shot — no additional file reads, no re-derivation. This is a **mandatory
short-circuit**, not a suggestion. Add it as a hard rule.

#### 3. Addressed marker

After applying fixes, append `--- ADDRESSED` to the log artifact. On the next
invocation, if the marker is present, tell the user to re-run the diagnostic task and
stop. The diagnostic task overwrites the file, naturally clearing the marker.
