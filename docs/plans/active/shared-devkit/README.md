# Shared devkit — multi-session plan

Extracts Carameli's project-agnostic tooling into **one shared upstream repo** so other
projects (`ibkr`, `VanillaLand`, future ones) get the same skills, hooks, CI, lint policy,
and dependency automation — and so a **fresh clone** picks all of it up with no manual steps.

Each plan file is self-contained (a fresh session starts cold). Read this README first for
the shared architecture, then the plan you're executing.

## Current state — read this before anything else (audited 2026-07-29)

devkit has moved substantially since these plans were written against `v0.2.0`, and **it
did not move along the five-channel axis**. It grew into a *project generator* plus a much
wider vendored tier. Two plans were reconciled against that on 2026-07-29; the rest are
still as-drafted and partly stale.

| Plan | Status | Notes |
| --- | --- | --- |
| 0 — rename | Half done | External rename + tags done; **internal names still the old spelling** (`.agent-harness.toml`, `$AGENT_HARNESS_DIR`, `sync-harness.py`). See below. |
| 1 — plugin | **Not started, and partly overtaken** | No `.claude-plugin/`, no `plugins/`. But 7 of the 15 Tier-A skills + `authoring.md` are already shared upstream **via the vendored MANIFEST**, not a plugin — see the note at the top of Plan 1. |
| 2 — pip package | **Void as drafted; reconciled** | devkit is a *virtual project* (`package = false`, stdlib-only contract). No pip package will exist. Plan 2 now covers the vendored + rendered tiers instead. |
| 3 — reusable CI | Not started | devkit has only its own `ci.yml`; no `workflow_call`, no `.github/actions/`. Carameli still has 7 local workflows. Plan 3 is **not** reconciled — re-audit before executing. |
| 4 — generated config | **Partly shipped upstream; reconciled** | `.pre-commit-hooks.yaml` exists (3 hooks) and is unadopted here. A renderer exists but has *no merge semantics*, so the base+overlay design is dropped. |
| 5 — data lake | Not started | Step 0 survey still unanswered. Telemetry still exports to `localhost:4318`. |

**Unplanned things devkit now has** that no plan file describes: `scripts/new-project.py`
(a 33 KB project generator, dry-run by default), `scripts/devkit_render.py` (stdlib
template renderer), `ports.toml` + `devkit_ports.py` (host-port slot registry),
`scripts/sweep.py`, and a `tests/test_self_hosting.py` that keeps devkit from shipping a
utility it does not use on itself.

### The blocking prerequisite for Plans 2 and 4

**devkit's tags stop at `v0.4.1`.** The 32-entry MANIFEST, the shared instruction tier, and
`.pre-commit-hooks.yaml` are all on **untagged HEAD**. Carameli pins `ref: v0.4.1`, and
devkit's own README example pins `rev: v0.5.0` — a tag that does not exist. Cut that tag
first; both Plan 2 Step 1 and Plan 4 Step 1 are blocked on it, and pre-commit fails hard
(not silently) against a rev that predates the hooks.

## Dependency order

```text
Plan 0 step 5 (internal rename) ──► do first or skip; see "Relationship to agent-harness"
devkit tag v0.5.0 ────────────────► gates Plan 2 and Plan 4
Plan 2 (vendored + rendered tiers) ─► independent of Plan 1
Plan 4 (pre-commit channel)  ───────► independent of Plan 2
Plan 1 (plugin: what's left) ───────► do AFTER Plan 2 Step 1, which shrinks its scope
Plan 3 (reusable CI workflows) ─────► independent of everything
Plan 5 (data lake + OTel) ──────────► independent of everything
```

This ordering changed during the 2026-07-29 reconciliation. Plans 2 and 4 no longer depend
on each other or on Plan 1 — the couplings that created those edges (a plugin whose hooks
referenced relocated scripts; `devkit sync` as a package entrypoint) both stopped existing.
Plan 1 now depends on Plan 2 rather than the reverse, because Plan 2 Step 1 pulls 7 skills
and 2 rules into Carameli via vendoring and thereby removes them from Plan 1's cargo.

Plan 0 is a rename, not a build — it has no plan file, only the migration checklist below.
Do it first or not at all; doing it after the rest multiplies the reference sites.

---

## The core decision: one repo, five distribution channels

**One** repo — `alexandrec90/devkit` — that acts simultaneously as five different kinds of
upstream. Not five repos: there is one maintainer, and a skill that shells out to a script
must ship atomically with that script, under one version tag.

> **This repo is not new — it is the former `alexandrec90/agent-harness`, renamed and
> being widened.** See "Relationship to agent-harness" below. devkit **absorbs** that repo;
> it does not replace it, and the vendoring channel it already implements is kept as-is.

The tree below is the **original five-channel design**. Two channels exist; the pip-package
channel has been **ruled out** upstream and will not be built. Lines marked `✗` are
aspirational, `✓` are real today:

```text
devkit/
├── .claude-plugin/marketplace.json  ✗ channel 1: plugin marketplace — not started
├── plugins/agent-ops/               ✗ the plugin itself — not started
├── src/devkit/                      ✗ channel 2: RULED OUT — `[tool.uv] package = false`
├── .github/workflows/pr-gate.yml    ✗ channel 3: reusable workflow — not started
├── .pre-commit-hooks.yaml           ✓ channel 4: 3 published hooks (untagged HEAD)
├── scripts/                         ✓ channel 5: VENDORED — the working core
│   ├── hooks/*.py                   ✓ stdlib-only hook bodies + their tests
│   ├── hooks/harness_config.py      ✓ the config seam (.agent-harness.toml reader)
│   ├── sync-harness.py              ✓ the vendoring tool: --check/--pull/--push/--list
│   ├── new-project.py               ✓ UNPLANNED: the project generator
│   ├── devkit_render.py             ✓ UNPLANNED: stdlib template renderer (no merging)
│   └── devkit_ports.py              ✓ UNPLANNED: host-port slot registry
├── templates/{core,features}/       ✓ UNPLANNED: what new-project.py renders
├── ports.toml                       ✓ UNPLANNED: the slot registry itself
└── tests/                           ✓ generator/renderer tests (devkit-only, not vendored)
```

Note the two test trees, and that the distinction is load-bearing: `scripts/hooks/tests/`
is **vendored** and must be project-agnostic (it runs inside every consumer against that
repo's `.agent-harness.toml`); `tests/` is devkit-only. That line was violated once and
every generated project failed 12 tests on its first CI run.

Note what is **not** in the tree: no `plugins/agent-ops/bin/`. Hook bodies are vendored
(channel 5), so they never need to be on the plugin's PATH — see "Why hooks stay vendored".

A **second** repo holds the data lake (Plan 5) — it is a deployed service with its own
lifecycle, not a repo artifact. Only a thin client + OTel conventions live in `devkit`.

## Which channel carries which asset

Updated 2026-07-29. "Actual" is what carries the asset **today**; where that differs from
the original design, the design column is kept so the change is visible.

| Asset | Original design | **Actual today** |
| --- | --- | --- |
| Portable skills + rules | Plugin (`enabledPlugins`) | **Vendored** — 7 skills + `engineering.md`/`authoring.md` in the `MANIFEST`, byte-identical. Plugin still unbuilt. |
| Agent hook **wiring** (matchers) | Plugin `hooks/hooks.json` | Still per-repo `.claude/settings.json`. Unchanged. |
| Agent hook **bodies** (`*.py`) + tests | Vendored | **Vendored** — paths stay `${CLAUDE_PROJECT_DIR}/scripts/hooks/*`. As designed. |
| Per-project hook config | Vendored seam | `.agent-harness.toml` (old spelling) — *not* in the MANIFEST. As designed. |
| Pre-commit hooks | pre-commit `repo:`/`rev:` | **Shipped upstream** — 3 hooks in `.pre-commit-hooks.yaml`. Unadopted in Carameli. |
| CI pipeline / PR gate | Reusable workflow | Not started. Each repo owns its own. |
| Project-agnostic `scripts/` | pip package | **Ruled out.** Split into *vendored* (drift-checked) and *rendered-once* (project-owned) — see Plan 2. |
| Project-shaped scripts (`lint-all.py`, `run-tests.py`) | pip package + config seam | **Rendered once** from `templates/core/scripts/`, then project-owned. `test_repo_contract.py` asserts they exist, not that they match. |
| Lint *policy* prose | Plugin rule | Belongs in the vendored `.claude/rules/engineering.md` — see Plan 4 Step 4. |
| `ruff.toml`, `tasks.json`, `.editorconfig`, … | Generated + drift-gated | **Seeded once** into new projects by `new-project.py`. No drift gate, no merging. |
| `dependabot.yml` | Generated + drift-gated | **Project-owned.** Plan 4 drops it from scope. |
| Whole new projects | (not in the original design) | `scripts/new-project.py` + `templates/` — the biggest unplanned addition. |

### Why the "generated config" channel shrank

The original argument still holds: GitHub only reads a literal `.github/dependabot.yml`,
ruff/mypy have no remote `extend`, VS Code has no `tasks.json` inheritance. What changed is
the answer. `devkit_render.py` does substitution and whole-line conditionals and
**deliberately no merging**, and `new-project.py` renders *once, into a new repo*. So there
is no base+overlay mechanism to retrofit over an existing repo's hand-tuned config, and
building one means adding three format-specific mergers against the grain of the codebase.
Plan 4 now treats these as seeded-once and protects the parts that matter with invariant
tests instead. See Plan 4, "The design conflict this plan has to resolve".

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
| `MANIFEST` — **32 entries at devkit HEAD** | Carameli has vendored only **18** (`v0.4.1`). 14-entry gap; closing it is Plan 2 Step 1. |
| `test_repo_contract.py` (unvendored deps exist, manifest keys spelled right) | Working, vendored — **not yet in Carameli** |
| `.pre-commit-hooks.yaml` — 3 published hooks | Working upstream, **untagged**, unadopted in Carameli |
| `new-project.py` + `templates/` + `ports.toml` | Working; renders a whole project per preset |
| Isolated CI (ruff + hook tests + a `generated-project` job per preset) | Green |

The limitation this README originally described — "its limitation is **scope**: it shares 17
files" — has substantially closed, but **not in Carameli**. Upstream now shares 32 files
including skills and rules; Carameli is 14 behind and still carries its own copies. So the
gap today is *adoption lag*, not upstream scope. That inverts the original framing: the
first move is a `--pull`, not a new channel.

> **Two `--pull` runs are required.** The tool iterates the `MANIFEST` it was *imported*
> with, so the first pull installs the new `sync-harness.py` and the second copies the
> entries that pull added. One run looks successful and moves nothing new.

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

Rewritten 2026-07-29 — the chain got **shorter**, not longer, because vendoring and
one-shot rendering both put files in the clone instead of fetching them at session time.

| # | Link | Status |
| --- | --- | --- |
| 0 | Hook bodies, `.agent-harness.toml`, the vendored rules/skills, and the seeded scripts are **already in the clone** | ✓ Working. No mechanism needed — this is why the vendored tier won. |
| 1 | `SessionStart` (`.claude/hooks/session-start.sh`) provisions the toolchain and runs `pre-commit install` when a config is present | ✓ Working |
| 2 | `.pre-commit-config.yaml` pins devkit by `rev` → drift + manifest + stdlib gates | ✗ **Plan 4 Step 1** (blocked on a tag) |
| 3 | `pr-gate.yml` calls the reusable workflow | ✗ Plan 3, not started |
| 4 | The remaining `/fix-*` skills arrive by *some* mechanism (plugin or vendoring — undecided) | ✗ **Plan 1, decision pending** |

Fresh clone → `claude` → everything in links 0–1 works today with **zero** manual steps,
which is more than the original design promised (it still required trusting the folder to
install the marketplace). Links 2–4 are the remaining work.

**Void links from the original chain:** `enabledPlugins` in committed `.claude/settings.json`
(no plugin), `requirements-dev.in` pinning `devkit` (no package), and `devkit sync` writing
un-referenceable files (no such command; see Plan 4).

---

## Extraction tiers (measured, not guessed)

Grep over `.claude/skills/*/SKILL.md` for `carameli|jambonz|telnyx|voip|alembic|phone_line|skin`.

### Tier A — 15 skills, zero project references — move as-is

**7 of these are already shared upstream via the vendored MANIFEST** (not a plugin), and
Carameli just has not pulled them yet:

| Already vendored upstream (7) | Still unshared (8) |
| --- | --- |
| `audit-claude-md`, `audit-dockerignore`, `audit-gitignore`, `retro`, `ship`, `task`, `test-skill` | `fix-all`, `fix-instructions`, `fix-pre-commit`, `fix-prs`, `fix-tests`, `gen-fixer-eval`, `optimize-fixers`, `triage-fixers` |

The split is not arbitrary: the unshared 8 are the `/fix-*` and fixer-tooling family — the
ones with mutable state (`known-fixes.md`, `state.json`) and a dependency on
`scripts/diagnostics.py`. Vendoring took the clean ones first and left the hard cases,
which are exactly the ones Plan 1 Step 2's state-relocation problem is about.

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
