# Shared devkit — multi-session plan

Extracts Carameli's project-agnostic tooling into **one shared upstream repo** so other
projects (`ibkr`, `VanillaLand`, future ones) get the same skills, hooks, CI, lint policy,
and dependency automation — and so a **fresh clone** picks all of it up with no manual steps.

**Channel 5 (vendored hooks) is already built and in production** at
`alexandrec90/devkit` — devkit absorbs the old `agent-harness` repo rather than replacing
it, and that repo *is* this one (renamed 2026-07-25, tagged `v0.1.0`). Channels 1–4 are
not implemented. Each plan file is self-contained (a fresh session starts cold). Read this
README first for the shared architecture, then the plan you're executing.

## Dependency order

```text
Plan 0 (rename agent-harness → devkit) ─► gates 1–4; see "Relationship to agent-harness"
Plan 1 (plugin: skills/rules) ─────────► Plan 2 (pip package: scripts/) ──► Plan 4 (generated config + drift gate)
Plan 3 (reusable CI workflows) ────────► (independent of 1 and 2)
Plan 5 (data lake + OTel) ─────────────► (independent of everything)
```

Plan 0 is a rename, not a build — it has no plan file, only the migration checklist below.
Do it first or not at all; doing it after Plans 1–4 multiplies the reference sites.

Plans 1 and 3 can run in parallel. Plan 2 depends on Plan 1 only because Plan 1's plugin
hooks reference script paths that Plan 2 relocates. Plan 4 depends on Plan 2 (`devkit sync`
is a package entrypoint). Plan 5 is standalone and can be done at any time.

---

## The core decision: one repo, five distribution channels

**One** repo — `alexandrec90/devkit` — that acts simultaneously as five different kinds of
upstream. Not five repos: there is one maintainer, and a skill that shells out to a script
must ship atomically with that script, under one version tag.

> **This repo is not new — it is the former `alexandrec90/agent-harness`, renamed and
> being widened.** See "Relationship to agent-harness" below. devkit **absorbs** that repo;
> it does not replace it, and the vendoring channel it already implements is kept as-is.

```text
devkit/                                  (= today's agent-harness, renamed)
├── .claude-plugin/marketplace.json    ← channel 1: agent plugin marketplace
├── plugins/agent-ops/                 ← the plugin itself
│   ├── .claude-plugin/plugin.json
│   ├── skills/                        ← the 25 shareable skills
│   ├── rules/                         ← the shareable rules
│   └── hooks/hooks.json               ← hook *wiring* only (matchers → commands)
├── src/devkit/                        ← channel 2: pip package (today's scripts/)
│   ├── lint_all.py  diagnostics.py  run_tests.py  docker_common.py  …
│   └── templates/                     ← files that CANNOT be remote-referenced
├── .github/workflows/pr-gate.yml      ← channel 3: reusable workflow (on: workflow_call)
├── .github/actions/setup-{python,node}-env/
├── .pre-commit-hooks.yaml             ← channel 4: pre-commit hook repo
├── scripts/                           ← channel 5: VENDORED (exists today)
│   ├── hooks/*.py                     ← stdlib-only hook bodies + their tests
│   ├── hooks/harness_config.py        ← the config seam (.devkit.toml reader)
│   └── sync-harness.py                ← the vendoring tool: --check/--pull/--push
└── tests/                             ← non-hook tests (the pip package's own)
```

Note what is **not** in the tree: no `plugins/agent-ops/bin/`. Hook bodies are vendored
(channel 5), so they never need to be on the plugin's PATH — see "Why hooks stay vendored".

A **second** repo holds the data lake (Plan 5) — it is a deployed service with its own
lifecycle, not a repo artifact. Only a thin client + OTel conventions live in `devkit`.

## Which channel carries which asset

| Asset | Channel | Mechanism |
| --- | --- | --- |
| Skills, rules, agent Markdown | Plugin | `extraKnownMarketplaces` + `enabledPlugins` in committed `.claude/settings.json` |
| Agent hook **wiring** (matchers) | Plugin | `hooks/hooks.json` at plugin root |
| Agent hook **bodies** (`*.py`) + their tests | **Vendored** | `sync-harness.py` `MANIFEST`; paths stay `${CLAUDE_PROJECT_DIR}/scripts/hooks/*` |
| Per-project hook config | **Vendored seam** | `.devkit.toml` at the consuming repo root — *not* in the MANIFEST |
| Pre-commit hooks | pre-commit | `repo: https://github.com/alexandrec90/devkit` + `rev: v1.x` — native, no vendoring |
| CI pipeline / PR gate | Reusable workflow | `uses: alexandrec90/devkit/.github/workflows/pr-gate.yml@v1` |
| Python tooling (non-hook `scripts/`) | pip package | pinned in `requirements-dev.in` |
| Lint *policy* prose | Plugin rule | "always bug-preventing, never superficial" is a rule, not a config |
| `ruff.toml`, `mypy.ini`, `dependabot.yml`, `tasks.json` | **Generated** | no remote-reference mechanism exists — render + drift-gate |

### Why some files must be generated

GitHub only reads a literal `.github/dependabot.yml`; ruff/mypy have no remote `extend`;
VS Code has no `tasks.json` inheritance. These get rendered by `devkit sync` from
`src/devkit/templates/`, and a CI job fails on drift.

**This pattern already exists in this repo** — the PR Gate `mirror-sync` job verifies
`scripts/sync-agents-context.py` output is in sync. Plan 4 is the same shape, one level up.

---

## Relationship to agent-harness

The repo formerly at `alexandrec90/agent-harness` already exists, works, and is adopted by
Carameli. It is the same project as devkit at an earlier stage of scope, so **devkit is
that repo renamed and widened — not a second repo, and not a rewrite.** Decided and
executed 2026-07-25.

What it already provides, which the remaining channels inherit rather than rebuild:

| Asset | Status |
| --- | --- |
| `sync-harness.py` (`--check/--pull/--push/--list`) | Working, unit-tested |
| `harness_config.py` + `.agent-harness.toml` seam | Working, unit-tested (`test_harness_config.py`) |
| 17-file `MANIFEST`, byte-verified against Carameli | In sync as of devkit `67e6863` (= `v0.2.0`) |
| Isolated CI (ruff + 151 stdlib-only hook tests) | Green |

Its limitation is **scope, not design**: it shares 17 files. Carameli has 43 skills,
20 rules, 39 scripts, 16 hooks, 58 hook tests, and 7 workflows. Channels 1–4 exist to
cover that remainder; channel 5 is that repo, unchanged.

### Plan 0 — the rename migration (status: half done)

Renaming touches two repos that must move in lockstep — a half-rename breaks the drift
check, because the `MANIFEST` is compared by path. The *external* half is done; the
*internal* half is deliberately not started.

| # | Step | Status |
| --- | --- | --- |
| 1 | Rename the GitHub repo `agent-harness` → `devkit`; update `origin` | **Done** |
| 2 | Tag `v0.1.0` so consumers pin a tag, never `@main` | **Done** |
| 3 | Point consumers' CI checkouts at `alexandrec90/devkit` | **Done** (Carameli) |
| 4 | Rename the local working-copy directory to match | **Blocked** — the folder is open in VS Code and Windows refuses the rename. Close the workspace folder first. Cosmetic only; `origin` is already correct. |
| 5 | Internal names: `.agent-harness.toml` → `.devkit.toml`, `AGENT_HARNESS_DIR` → `DEVKIT_DIR`, `HARNESS_VERSION` → `DEVKIT_VERSION`, `sync-harness.py` → `sync-devkit.py` | **Not started** — see below |

Step 5 is the risky one and is intentionally separate. `sync-harness.py` is **itself in the
`MANIFEST`**, so renaming it changes the path list that the drift check compares by — the
tool has to rename itself and its own manifest entry in the same commit, in every repo, or
`--check` fails on the next PR in whichever repo lands second. The five names appear in
`harness_config.py`, `sync-harness.py`, their tests, `.claude/rules/tooling.md` (plus its
`.agents/` mirror), and `pr-gate.yml`.

Do step 5 as a single atomic change across devkit **and every consumer**, then re-tag.
Verify with `sync-harness.py --check` from each consumer *before* the commits land.

> Sequence step 5 **before** Plans 1–4 or skip it entirely. Renaming after the plugin and
> pip channels exist multiplies the blast radius across four more reference sites. Note
> that GitHub's rename redirect covers git remotes but **not** `raw.githubusercontent.com`,
> which is how the bootstrap `curl` in devkit's README fetches the sync tool.

## Why hooks stay vendored (channel 5, not channel 2)

Plan 2 originally proposed moving the hooks into the pip package or the plugin's `bin/`.
Both are wrong, for a reason that is already written down in `.claude/rules/tooling.md`:

> **stdlib only** — no third-party packages. Hooks run before the virtualenv is activated.

- **pip package: impossible.** A hook importing `devkit.config` fails whenever devkit is
  not yet installed — which includes the first session on a fresh clone, exactly the case
  the fresh-clone chain exists to serve.
- **Plugin `bin/`: works, but regresses two things.** It puts hook bodies in a cache
  *outside* the repo, which is wiped on plugin update (Plan 1 Step 2 already flags this as
  hostile to mutable skill state), and it makes hook behaviour invisible in the consuming
  repo's diff.
- **Vendoring: already solved.** The file is in the clone. No network, no install prompt,
  no import path, no PyPI-vs-bump-workflow decision — Plan 2's blocking decision does not
  apply to this tier at all.

Vendoring's real cost is that it rots silently unless the drift gate genuinely runs. That
is a wiring problem, and it is fixed — see the next section.

### The drift gate must actually gate

`sync-harness.py` no-ops clean (exit 0) when `$AGENT_HARNESS_DIR` is unset. That is
correct pre-adoption behaviour, and a trap afterwards: Carameli wired the `--check` call
into the PR gate but never set the variable, so the gate passed green for every PR while
checking nothing. It was hiding real drift (`test_harness_config.py`).

The gate is only meaningful with all three of these, and each has a failure mode:

1. **Check the harness repo out in CI.** It is public, so no token is needed.
2. **Pin a tag, never `@main`.** One bad harness commit must not redden every consumer.
3. **Check out *after* any `git status --porcelain` step.** The checkout lands an
   untracked directory in the workspace; a drift check running after it reports that
   directory and fails. In Carameli this collides with the `mirror-sync` job specifically.

---

## The fresh-clone chain (the portability requirement)

Every link exists in some form today:

0. **Hook bodies and `.devkit.toml` are already in the clone** — vendored, no step at all.
   This link is the strongest one in the chain precisely because it needs no mechanism.
1. `.claude/settings.json` (committed) declares the marketplace + `enabledPlugins`
   → agent config arrives on first session, no manual `/plugin install`
2. The **existing** `SessionStart` hook (`.claude/hooks/session-start.sh`) installs the venv
   → add `devkit` to what it installs
3. `requirements-dev.in` pins `devkit` → all non-hook scripts on PATH
4. `.pre-commit-config.yaml` references the remote hook repo by `rev`
5. `pr-gate.yml` shrinks to ~15 lines calling the reusable workflow
6. `devkit sync` writes the un-referenceable files; CI fails on drift

Fresh clone → `claude` → everything works. Only manual step is trusting the folder
(Claude Code prompts to install project-declared marketplaces on first trust).

---

## Extraction tiers (measured, not guessed)

Grep over `.claude/skills/*/SKILL.md` for `carameli|jambonz|telnyx|voip|alembic|phone_line|skin`.

### Tier A — 15 skills, zero project references — move as-is

`audit-claude-md`, `audit-dockerignore`, `audit-gitignore`, `fix-all`, `fix-instructions`,
`fix-pre-commit`, `fix-prs`, `fix-tests`, `gen-fixer-eval`, `optimize-fixers`, `retro`,
`ship`, `task`, `test-skill`, `triage-fixers`

### Tier B — 10 skills, 1–2 incidental references — move after de-coupling

`check-logging`, `fix-lint`, `fix-logs`, `fix-e2e`, `update-skills-chart`, `audit-skills`,
`plan-handoff`, `refactor`, `stack-review`, `update-meta-coding-chart`

The hits are single words (`alembic` in `fix-lint`, `phone_line` in a `fix-logs` example,
`Carameli` in prose). Replace with a placeholder or a project-config lookup.

### Tier C — stays in Carameli, do not extract

`add-skin`, `add-ui-component`, `add-endpoint`, `add-db-model`, `check-migrations`,
`check-boundaries`, `audit-design-flaws`, `make-tests`, `make-frontend-tests`, `review`,
`fix-docker`, `fix-workflows`, `audit-deps`, `lint-secrets`, `update-*-chart` (project ones)

### Rules

| Move | Verify then move | Stays |
| --- | --- | --- |
| `authoring.md`, `naming.md`, `python-style.md`, `frontend-style.md`, `logging-frontend.md`, `tooling.md`, `diagnostics.md`, `migrations.md` | `testing.md` (3 hits), `security.md` (2 hits) | `skin-*.md` (5 files), `voip-providers.md`, `webhooks.md`, `database.md`, `logging-backend.md` |

`tooling.md` greps clean and reads clean (script/hook conventions, not stack config) —
confirmed by inspection, not just grep. `authoring.md`'s 5 hits are all in examples.

> ⚠️ **Grep is a filter, not a verdict.** Read every Tier-B candidate before moving it.
> A rule that is 60% generic gets *worse for both projects* when shared. When in doubt,
> leave it in Carameli — extraction is cheap to do later, expensive to undo.

---

## Sharp edges (carry into every plan)

- **Namespacing churn.** Plugin skills become `/agent-ops:fix-lint`, not `/fix-lint`.
  Project `.claude/skills/` entries are *not* overridden by plugin skills — both remain
  available — so migration can be incremental, but muscle memory and any docs referencing
  `/fix-tests` change. Decide the plugin name early; it is the namespace prefix.
- **Plugins are cached outside the repo.** A plugin file referencing `scripts/foo.py`
  relative to the repo breaks. Use `${CLAUDE_PROJECT_DIR}` for repo paths and
  `${CLAUDE_PLUGIN_ROOT}` for plugin-internal ones. Today's 8 hooks in
  `.claude/settings.json` all use `${CLAUDE_PROJECT_DIR}/scripts/hooks/*.py`, and — per
  the channel-5 decision — **they stay that way.** Only the wiring moves into the plugin;
  the bodies stay vendored in the consuming repo, so `${CLAUDE_PROJECT_DIR}` remains
  correct. Do not "modernize" these to `${CLAUDE_PLUGIN_ROOT}`.
- **Never pin `@main`.** One bad devkit commit must not redden three repos at once. Tag
  releases; pin tags everywhere.
- **Dependabot cannot reliably bump a pip git-ref pin.** It *does* bump `uses:` refs
  (github-actions ecosystem), and pre-commit `rev`s are handled by `pre-commit autoupdate`.
  For the pip pin: publish `devkit` to PyPI, or add a small weekly bump workflow. Pick one
  in Plan 2 — do not leave it unpinned to dodge the problem.
- **`sync-agents-context.py` gains a target.** It already emits `.agents/` and
  `.codex/hooks.json` from `.claude/`. Plugin `hooks/hooks.json` is a fourth output.
  Consolidate the generator rather than accreting a fourth ad-hoc script.
- **Carameli's PR gate gets faster.** Once `scripts/` + its 50 tests move (Plan 2), devkit's
  own CI owns those tests. Remove the `pytest scripts/hooks/tests/` step from Carameli's
  backend job in the same change — do not leave it running against a moved tree.

## Explicitly out of scope

- Sharing the `known-fixes.md` **corpus**. Share the *format*; keep per-project content.
  Cross-project fix corpora produce confidently wrong matches.
- Migrating VanillaLand (.NET/SQL Server). It consumes nothing here.
- Any change to Carameli's application code (`app/`).
