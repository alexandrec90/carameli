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

#### 3. Investigation budget (hard cap on file reads)

Every fixer must declare a per-error read cap in both the step instructions and a hard
rule. Recommended caps:

| Skill type | Cap | Rationale |
|---|---|---|
| Lint fixers | 3 reads | Errors are self-locating (file:line:col + rule ID) |
| Test / E2E fixers | 5 reads | Need test file + application file + limited context |
| Log / runtime fixers | 5 reads | Log gives module:line, but may need call chain |

After hitting the cap, the model must attempt a fix or ask the user. "Keep reading" is
not an option.

#### 4. Addressed marker

After applying fixes, append `--- ADDRESSED` to the log artifact. On the next
invocation, if the marker is present, tell the user to re-run the diagnostic task and
stop. The diagnostic task overwrites the file, naturally clearing the marker.
