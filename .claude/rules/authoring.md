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
