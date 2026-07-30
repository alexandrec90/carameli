# Plan 1 — Create the devkit repo and extract skills/rules as a plugin

**Depends on:** Plan 2 Step 1 (see the scope note below — it removes 8 of this plan's 23
listed files, leaving 15). **Parallel with:** Plan 3, Plan 5.
**Read first:** `docs/plans/active/shared-devkit/README.md` (architecture, extraction tiers, sharp edges).

> ## ⛔ Recommendation: close this plan unbuilt (2026-07-30)
>
> **Everything below is preserved for the record. Do not execute it without first taking the
> decision in this box.** The 2026-07-29 note said part of this plan's job had been done by
> another mechanism and asked whether a plugin was still worth building. Re-auditing devkit
> on 2026-07-30 turned that from an open question into a near-answer.
>
> ### What vendoring now carries
>
> devkit's `MANIFEST` (39 entries at HEAD `2209f61`) ships, byte-identical and
> drift-checked:
>
> - **Rules:** `.claude/rules/authoring.md`, `.claude/rules/engineering.md`
> - **Skills (10):** `ship`, `task`, `retro`, `test-skill`, `audit-claude-md`,
>   `audit-gitignore`, `audit-dockerignore`, **`fix-pre-commit`**, **`plan-handoff`**,
>   **`refactor`**
>
> That is **10 of the 15 Tier-A skills** in Step 2 and 1 of the 8 rules in Step 3, already
> shared — without a plugin, a marketplace, or a namespace prefix.
>
> ### The mutable-state problem — Step 2's strongest argument — is solved without a plugin
>
> Step 2 below says state "must not live in the plugin cache — it is wiped on update" and
> treats relocating it as this plan's hard part. Upstream sidestepped it: **vendor the
> prose, seed the state empty.** `fix-pre-commit`, `plan-handoff`, and `refactor` ship their
> `SKILL.md` only; their `known-fixes.md` / `state.json` stay per-project because vendoring
> them would reset every project's hit counts on each `--pull` — and hit counts are what
> `normalize-known-fixes.py` prunes against. `new-project.py` seeds them empty.
>
> No cache to be wiped, no `${CLAUDE_PLUGIN_ROOT}` redirection, no state migration.
>
> ### Most of the remainder will never be vendored *or* plugged — by decision
>
> devkit's README now records why (see "The shared instruction tier"):
>
> - `fix-all`, `fix-lint` — dispatch to `fix-tests`/`fix-docker`/`fix-e2e`, which are not
>   portable. "A vendored dispatcher whose children don't ship is a skill that dead-ends."
>   Putting the dispatcher in a plugin does not ship the children either.
> - `triage-fixers`, `gen-fixer-eval`, `fix-instructions`, `optimize-fixers` — bound to a
>   promptfoo `evals/` harness devkit does not ship.
> - `audit-deps` — written against `requirements.in`/pip-tools; generated projects are
>   uv-native.
>
> ### What is actually left
>
> - **Skills (2):** `fix-prs`, `fix-tests`. That is the entire remaining Tier-A cargo.
> - **Rules (7):** `naming.md`, `python-style.md`, `frontend-style.md`,
>   `logging-frontend.md`, `tooling.md`, `diagnostics.md`, `migrations.md` — all of which
>   the vendored tier could carry today by adding seven MANIFEST lines.
>
> **Two skills and seven markdown files do not justify a second distribution mechanism**,
> a marketplace, a `plugin.json` version stream, a permanent `/agent-ops:` namespace
> prefix, and the cache-location caveats in "Sharp edges". The cost of the plugin channel
> is fixed and the payload has shrunk by 80% since the plan was written.
>
> ### The one thing a plugin still does better
>
> Honesty requires stating it: **hook wiring** (Step 4). `hooks.json` in a plugin would
> share the matcher block that every consumer currently hand-maintains in
> `.claude/settings.json`, and vendoring cannot carry that file (each project's differs).
> If a plugin is ever built, that — not skills — is its justification. Note it is also the
> smallest possible plugin: one `hooks.json`, no skills, no rules.
>
> ### Recommended decision
>
> 1. **Close Plan 1.** Move `fix-prs` + `fix-tests` and the 7 rules to Plan 6 as ordinary
>    MANIFEST-extension candidates, evaluated one at a time with the Tier-B caution the
>    README already prescribes.
> 2. **Reopen only if** a third consumer appears *and* hook-wiring drift between repos
>    becomes a real observed problem — then build the `hooks.json`-only plugin.
>
> ### DECISION TAKEN — 2026-07-30: **closed unbuilt**
>
> No plugin, no marketplace, no `agent-ops` namespace. The payload had shrunk to 2 skills
> and 7 rules, and the vendored tier demonstrably carries both asset classes today.
>
> - `fix-prs` and `fix-tests` move to **Plan 6** as ordinary MANIFEST-extension
>   candidates, evaluated one at a time.
> - The 7 rules (`naming`, `python-style`, `frontend-style`, `logging-frontend`,
>   `tooling`, `diagnostics`, `migrations`) likewise — each is seven MANIFEST lines, not
>   a distribution channel.
> - **Reopen only if** a third consumer appears *and* hook-wiring drift between repos
>   becomes a real observed problem. Then build the `hooks.json`-only plugin described
>   above — one file, no skills, no rules.
>
> Everything below this box is preserved as the record of why. Do not execute it.
> Step 2's file list, Step 3's rule list, and the "15 skills" in the Goal are all stale.

## Goal

Stand up `alexandrec90/devkit` as a Claude Code plugin marketplace, move the 15 Tier-A
skills plus the shareable rules into an `agent-ops` plugin, and wire Carameli's committed
`.claude/settings.json` to install it automatically. After this plan a fresh clone of
Carameli gets the shared skills on first session with no manual `/plugin install`.

Scripts stay where they are (`scripts/`) — Plan 2 moves them. Plugin skills that shell out
keep using `${CLAUDE_PROJECT_DIR}` for now.

## Blocking decisions

1. **Repo name — DONE (2026-07-25).** The repo is the former
   `alexandrec90/agent-harness`, **renamed** to `alexandrec90/devkit` — not a new repo.
   Already executed, along with the `v0.1.0` tag. The *internal* names
   (`.devkit.toml`, `$DEVKIT_DIR`, `sync-devkit.py`) are **still the old
   spelling on purpose** — see Plan 0 step 5 in the README. Use the old names in anything
   you write until that migration lands.
2. **Repo visibility — SETTLED, no decision needed.** The repo is **public**
   (`gh repo view` confirms). That removes the Plan 3 private-repo caveat about cross-repo
   Actions access, and means CI checkouts of it need no token. Keep it public.
3. **Plugin name.** Still open, and the one that matters: `name` in `plugin.json` becomes
   the skill namespace prefix forever (`/agent-ops:fix-tests`). Note it is **independent of
   the repo name** — repo `devkit`, plugin `agent-ops` is fine and is the recommendation.
4. **One plugin or several.** Recommendation: one (`agent-ops`). Splitting into
   `fixers` / `audits` / `workflow` multiplies namespaces and version tags for no benefit
   at this scale.

## Step 1 — Add the plugin scaffold to the existing repo

The repo already exists and already has content (`scripts/`, `ruff.toml`,
`.github/workflows/ci.yml`, a green 151-test suite). **Add** to it; do not initialize
anything, and do not disturb `scripts/` — that is channel 5 and it is load-bearing today.

```text
devkit/
├── .claude-plugin/marketplace.json    ← new
├── plugins/agent-ops/                 ← new
│   ├── .claude-plugin/plugin.json
│   ├── skills/
│   ├── rules/
│   └── hooks/hooks.json
├── scripts/                           ← EXISTS — leave alone
└── README.md                          ← rewrite: it currently describes only channel 5
```

Extend `.github/workflows/ci.yml` (which today runs `ruff check .` + the hook tests) with
`claude plugin validate` rather than adding a second workflow.

`plugins/agent-ops/.claude-plugin/plugin.json`:

```json
{
  "name": "agent-ops",
  "description": "Fixer, audit, and workflow skills for agent-driven repos",
  "version": "0.1.0",
  "author": { "name": "Alexandre Charbonneau" }
}
```

Set an explicit `version` — without it, the git commit SHA is used and *every commit*
counts as a new version for update purposes.

`.claude-plugin/marketplace.json` lists the plugin and its path. Run
`claude plugin validate` before the first tag; the same check gates community submissions
and catches structural mistakes early.

> **Structural trap:** only `plugin.json` goes inside `.claude-plugin/`. `skills/`,
> `hooks/`, `agents/`, `bin/` must be at the **plugin root**, not inside `.claude-plugin/`.

## Step 2 — Move the Tier-A skills

Move these 15 directories from `.claude/skills/` to `devkit/plugins/agent-ops/skills/`:

`audit-claude-md`, `audit-dockerignore`, `audit-gitignore`, `fix-all`, `fix-instructions`,
`fix-pre-commit`, `fix-prs`, `fix-tests`, `gen-fixer-eval`, `optimize-fixers`, `retro`,
`ship`, `task`, `test-skill`, `triage-fixers`

For each, before moving:

- Read the SKILL.md end to end. The grep said zero project references; confirm it.
- Rewrite any path that assumes the plugin lives in the repo. Repo-relative paths
  (`logs/test-failures.log`, `scripts/lint-all.py`) stay repo-relative — they resolve
  against the *consuming* project, which is correct. Plugin-internal siblings
  (`known-fixes.md`, `state.json`) need `${CLAUDE_PLUGIN_ROOT}`.
- Note which skills carry mutable state (`state.json`, `known-fixes.md`). **State must not
  live in the plugin cache** — it is wiped on update. Redirect those writes to the
  consuming project (`logs/agent/` or `.claude/state/`). This affects at least
  `optimize-fixers`, `triage-fixers`, and the `state-tools` consumers. Resolve per skill;
  do not defer.

## Step 3 — Move the rules

Move to `devkit/plugins/agent-ops/rules/`: `authoring.md`, `naming.md`, `python-style.md`,
`frontend-style.md`, `logging-frontend.md`, `tooling.md`, `diagnostics.md`, `migrations.md`.

Read `testing.md` and `security.md` and decide — they have 2–3 project references each and
may be worth splitting into a generic base plus a Carameli-specific overlay.

Rules are loaded by path-scoping frontmatter. Verify the `paths:` globs still make sense
from a plugin (they are evaluated against the consuming project's tree).

## Step 4 — Move the hook wiring

Copy the `hooks` object from Carameli's `.claude/settings.json` into
`devkit/plugins/agent-ops/hooks/hooks.json` — **the format is identical**.

Which hooks are shareable:

| Hook | Script | Shareable? |
| --- | --- | --- |
| `UserPromptSubmit` | `branch-per-task.py` | yes — **already vendored** |
| `PreToolUse` (Bash) | `enforce-capped-bash.py` | yes — vendor it (extend MANIFEST) |
| `PreToolUse` (`.*`) | `pretool.py` | yes — vendor it (extend MANIFEST) |
| `PostToolUse` (edits) | `lint-fix.py` | yes — **already vendored** |
| `PostToolUse` (edits) | `add-db-model/after-model-edit.py` | **no** — Tier C, stays |
| `PostToolUseFailure` | inline echo (instruction-feedback policy) | yes |
| `PostToolUse` (`^Skill$`) | inline echo (skill retro policy) | yes |
| `Stop` | `stop.py` | yes — **already vendored** |

Paths stay `${CLAUDE_PROJECT_DIR}/scripts/hooks/*.py` — **permanently**, not just in this
plan. Per the channel-5 decision, only the wiring moves into the plugin; the bodies stay
vendored in the consuming repo, so `${CLAUDE_PROJECT_DIR}` is the correct root and Plan 2
does **not** flip them. Three of the five script-backed hooks above are already in the
`MANIFEST` today; the other two get added to it, which is the whole of their migration.

> The plugin ships `hooks.json` (matchers → commands). The consuming repo ships the
> commands. That split is what lets a hook stay stdlib-only and survive a fresh clone with
> no install step — see the README's "Why hooks stay vendored".

## Step 5 — Wire Carameli to the marketplace

Add to Carameli's committed `.claude/settings.json`:

```json
{
  "extraKnownMarketplaces": {
    "devkit": {
      "source": { "source": "github", "repo": "alexandrec90/devkit" }
    }
  },
  "enabledPlugins": ["agent-ops@devkit"]
}
```

Then remove the migrated skills/rules and the migrated `hooks` entries from Carameli's
`.claude/` — otherwise both copies load. (Project rules and agents *override* same-named
plugin ones; plugin skills are namespaced so both remain callable. Duplicated hooks would
genuinely double-fire.)

Verify `scripts/sync-agents-context.py` still produces a correct `.agents/` mirror once
`.claude/skills/` has shrunk — its orphan-purge logic will delete the corresponding
`.agents/skills/*` entries, which is correct but should be confirmed, and the existing
tests in `scripts/hooks/tests/test_sync_agents_context.py` must still pass.

## Step 6 — Tag and verify

1. Tag devkit `v0.1.0`.
2. In a **fresh clone** of Carameli: run `claude`, trust the folder, confirm the install
   prompt appears, then `/plugin list` shows `agent-ops@devkit` and `/agent-ops:fix-tests`
   resolves.
3. Run `python scripts/lint-all.py` and the PR gate locally — the mirror-sync job must be
   green with the reduced `.claude/` tree.

## Tests

- devkit repo: `claude plugin validate` in its own CI on every push.
- Carameli: existing `test_sync_agents_context.py` must pass unchanged. If the reduced
  tree breaks an assertion, fix the test's fixture, not the generator.
- Add a Carameli test asserting `.claude/settings.json` declares the marketplace and that
  no migrated skill directory remains under `.claude/skills/` (prevents silent re-drift).

## Definition of done

- [ ] devkit repo exists, tagged `v0.1.0`, `claude plugin validate` green
- [ ] 15 Tier-A skills + 8 rules live in the plugin, removed from Carameli
- [ ] Shared hooks in `hooks/hooks.json`; `after-model-edit.py` still wired locally
- [ ] Mutable skill state writes to the consuming project, not the plugin cache
- [ ] Fresh clone of Carameli picks up the plugin with no manual install command
- [ ] PR gate green, mirror-sync green
