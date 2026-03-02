# Skin Design Briefs

<!-- markdownlint-disable MD024 MD036 MD040 MD060 -->

Raw design documents for skins — inspiration, mood boards, rough specs.
These are **your input**, written in whatever format makes sense.

## Workflow

1. Drop a design brief here: `skins/<name>.txt` or `skins/<name>.md`
2. Ask the agent to translate it into `.claude/rules/skin-<name>.md`
3. The agent follows the rule file when writing code in `frontend/src/skins/<name>/`

## Why two files?

| File | For | Contains |
| --- | --- | --- |
| `skins/<name>.txt` | You | Inspiration, rough specs, natural language descriptions |
| `.claude/rules/skin-<name>.md` | The agent | Exact hex values, component patterns, hard constraints, forbidden patterns |

The rule file is what gets automatically loaded by the agent based on `paths:` scoping.
The brief is source material — keep it for reference when iterating on the design.

## Files

| Brief | Rule file | Status |
| --- | --- | --- |
| `candy-shop.txt` | `.claude/rules/skin-candy-shop.md` | Ready |
| _(carameli — no brief, rule file authored directly)_ | `.claude/rules/skin-carameli.md` | Ready |
