---
description: Conventions for authoring .claude rules and skills files
paths:
  - .claude/rules/**/*.md
  - .claude/skills/**/SKILL.md
---

# Rule: Rules & Skills Authoring

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
- Begin the body with `# Rule: <Name>` immediately after the frontmatter.
- Keep rules focused on a single domain — don't mix unrelated conventions in one file.

## Skills (`.claude/skills/`)

- Each skill lives in `.claude/skills/<name>/SKILL.md`.
- If the skill generates scripts, those scripts must follow the PowerShell
  conventions in `.claude/rules/tooling.md` (especially `-T` for `docker compose exec`
  and `[Environment]::Exit()`).

### Description field requirements (critical for skill discovery)

The `description` field is how the agent decides which skill to invoke. It must include
both **what** the skill does and **when** to use it:

```yaml
# Good — includes both what and when
description: 'Adds a SQLAlchemy model and Alembic migration. Use when introducing a new table or adding/changing columns.'

# Bad — missing trigger
description: 'Add a database model and Alembic migration.'
```

- Write in third person (e.g. "Generates…", "Audits…", not "Generate…" or "I can…")
- Include a "Use when…" clause with concrete triggers
- Maximum 1024 characters — be specific but concise

### SKILL.md size limit

Keep `SKILL.md` under **500 lines**. If content exceeds this, apply progressive disclosure:

1. Extract reference material into a sibling file (e.g. `writing-conventions.md`)
2. Keep all references **one level deep** — `SKILL.md` → `reference.md` (never deeper)
3. Add a table of contents to any reference file longer than 100 lines
4. Use forward slashes in all file paths — never backslashes

### Naming

Use action-oriented names (`add-endpoint`, `fix-tests`) or gerund form (`adding-endpoints`).
Avoid vague names (`helper`, `utils`). Use lowercase letters, numbers, and hyphens only.
