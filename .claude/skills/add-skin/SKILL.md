---
name: add-skin
description: Add and register a new Carameli frontend skin from a design brief. Use only when creating a new entry under frontend/src/skins; do not use for ordinary component work inside an existing skin.
---

# Add a frontend skin

1. Read `.claude/rules/skin-architecture.md`, `frontend/src/skins/types.ts`, and the
   supplied design brief. If no brief exists, copy `templates/brief.md` and resolve its
   open decisions before writing code.
2. Create `.claude/rules/skin-<name>.md` with path-scoped, non-generic visual constraints.
   Keep detailed product rationale in `docs/product/skins/`, not in the rule.
3. Preview the deterministic scaffold:

   ```text
   python .claude/skills/add-skin/scripts/scaffold.py <kebab-name> "<Display Name>" --dry-run
   ```

4. Run the same command without `--dry-run`. It copies the functional `barebone` skin,
   registers the dynamic import/loading state, and adds the switcher label.
5. Replace the copied presentation with the brief's design. Preserve the complete
   `SkinViews` contract; data fetching remains in shared hooks.
6. Run `npm --prefix frontend run typecheck` and the registry/skin tests. Add focused
   tests for any new rendering or interaction behavior.

Do not add a skin until its brief and scoped rule exist. Do not copy data hooks, API
clients, routes, or shared formatters into a skin.
