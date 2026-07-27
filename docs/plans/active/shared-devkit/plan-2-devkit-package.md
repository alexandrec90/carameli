# Plan 2 — Extract `scripts/` into the `devkit` pip package

**Depends on:** Plan 1 (plugin exists; hooks reference script paths this plan relocates).
**Read first:** `docs/plans/active/shared-devkit/README.md`.

## Goal

Move the project-agnostic half of `scripts/` (45 scripts + 13 hooks + 50 test files) into
`devkit`'s Python package, install it into consuming projects via a pinned dependency, and
repoint the plugin hooks at it. This is the biggest single win: `diagnostics.py` and the
`logs/*.log` artifact contract are what make the `/fix-*` skills work at all, and every
project wants them.

## Blocking decision: how the pin gets bumped

Dependabot does **not** reliably bump a pip git-ref pin. Pick one before writing code:

| Option | Cost | Notes |
| --- | --- | --- |
| **Publish to PyPI** (recommended) | one-time setup + a release workflow | Dependabot's `pip` ecosystem bumps it like any package; works with the existing `minor-and-patch` group |
| Git ref pin + weekly bump workflow | a ~30-line workflow per repo | Keeps devkit private; more moving parts |
| Git ref pin, manual bumps | zero | Will rot. Do not choose this |

Whichever wins, **pin a tag** — never `@main` (see README sharp edges).

## Step 1 — Classify every script

Three buckets. Do this as an explicit inventory before moving anything.

### Move to devkit — generic infrastructure

- **Diagnostics contract:** `diagnostics.py`, `extract-log-errors.py` — the format shared
  by `lint-all.py` and `run-tests.py` and consumed by every `/fix-*` skill
- **Runners:** `lint-all.py`, `run-tests.py`, `run-ci.py`, `run-e2e.py`, `run-load.py`,
  `run-mutation.py`
- **Docker helpers:** `docker_common.py`, `docker_win.py`, `docker-up/down/status/restart-app/prune/fix/migrate.py`
- **Dependency tooling:** `recompile-locks.py`, `check-lock-markers.py`, `venv-install.py`
- **Agent-context generators:** `sync-agents-context.py`, `sync-agents-settings.py`, `sync-codex-hooks.py`
- **Workflow ergonomics:** `notify.py`, `notify-wrap.py`, `ship.py`, `start-task.py`,
  `task_branch.py`, `archive-done-todos.py`, `install-pre-commit.py`, `pre-commit.py`,
  `script_common.py`, `lint-instructions.py`
- **Tests:** the ~45 of 58 files in `scripts/hooks/tests/` covering the above

**Not** the hooks in `scripts/hooks/` — they are generic, but they ship via channel 5
(vendoring), not the pip package. See Step 3, "The hooks do not move".

### Stays in Carameli — project-specific

`start-ngrok.py`, `sync-sandbox-secrets.py`, `backup_restore_test.py`,
`compress-comic-book-images.py`, `compress-images.js`, `gen-eval-fixture.py` (verify —
may be generic), and their tests (`test_start_ngrok.py`, `test_sync_sandbox_secrets.py`,
`test_backup_restore_test.py`, `test_compose_worktree_isolation.py`).

### Needs a config seam — generic logic, project-specific values

`docker_common.py` and `run-tests.py` assume compose service names (`app`, `worker`,
`postgres`) and a `tests/` layout. `lint-all.py` hardcodes the tool set and the
`frontend/` path. These move, but read their per-project values from config (Step 2).

## Step 2 — The config seam — DECIDED: reuse `.devkit.toml`, build nothing

The earlier draft proposed a `[tool.devkit]` table in `pyproject.toml`. **Do not build
that.** The seam already exists, is unit-tested, and is in production in Carameli:
`harness_config.py` reading `.agent-harness.toml` (→ `.devkit.toml` after the rename).
Extend it with the fields this plan needs; do not stand up a second parallel config system.

Why the standalone file wins over `[tool.devkit]` in `pyproject.toml`:

- **Hooks must read it before the venv exists.** Both are `tomllib`-parseable, so this is
  not a hard blocker — but a project's `pyproject.toml` is a build artifact that a hook has
  no other reason to touch, and coupling hook config to it invites a build-system change to
  break the Stop hook.
- **It is language-neutral.** A consumer with no `pyproject.toml` still gets the harness.
- **It already exists and is tested.** `test_harness_config.py` covers the loader,
  including the never-raises contract (a missing or malformed manifest falls back to
  neutral defaults rather than breaking every hook in the repo).

Fields this plan adds to the existing schema — as a new table, leaving `[stop]`, `[db]`,
and `[frontend]` untouched:

```toml
[lint]
tools = ["ruff", "mypy", "vulture", "pip-audit", "eslint", "tsc", "stylelint"]

[compose]
app_service = "app"
db_service = "postgres"
```

Follow the existing convention in `harness_config.py`: every field gets a dataclass default,
so a project with a conventional layout needs no config at all.

> `.devkit.toml` is deliberately **not** in the `MANIFEST` — it is per-project config, not
> shared code. Keep it that way; adding it would make every consumer drift on day one.

## Step 3 — Package layout and entrypoints

```text
src/devkit/
├── __init__.py
├── diagnostics.py
├── lint_all.py
├── run_tests.py
├── docker/…
└── templates/           # Plan 4 lives here

scripts/                 # NOT packaged — channel 5, vendored, unchanged
├── hooks/*.py           # the 16 hook scripts + harness_config.py
└── sync-harness.py
```

Console scripts in `pyproject.toml`: `devkit-lint`, `devkit-test`, `devkit-docker`,
`devkit-sync` (Plan 4). VS Code tasks and CI call these instead of `python scripts/x.py`.

### The hooks do not move — DECIDED

The earlier draft left this open ("Either keep hooks fully self-contained, or have the
plugin ship them under `bin/`. Decide this before moving the hooks."). **Resolved: neither.
The hooks stay vendored** (channel 5) and are not packaged at all.

The constraint that forces it is already written in `.claude/rules/tooling.md`: hook scripts
are **stdlib only** because they run before the virtualenv is active. So:

- **Packaging them is impossible**, not merely awkward. A hook importing `devkit.config`
  fails on any clone where devkit is not yet installed — including the first session on a
  fresh clone, which is the case the whole portability requirement exists to serve.
- **Plugin `bin/` would work but regresses two things**: hook bodies land in a cache
  outside the repo that is wiped on plugin update, and hook behaviour stops appearing in
  the consuming repo's diff.

So `src/devkit/` has **no** `config.py` and **no** `hooks/`. The config seam lives in
`scripts/hooks/harness_config.py` (Step 2) and is reached by vendoring, not by import.

> Consequence for Step 1's inventory: the line "**All 13 hooks** in `scripts/hooks/`
> **except** none — all are generic" is right about them being generic and wrong about
> where they go. They are generic *and* they stay in `scripts/`. Their sharing mechanism is
> the `MANIFEST`, which already carries 6 of them; widening it is the migration.

## Step 4 — Widen the MANIFEST (replaces "repoint the plugin hooks")

The earlier draft had this step flip hook paths to `${CLAUDE_PLUGIN_ROOT}`. That is void —
hook paths do not change, because the bodies do not move. **Nothing to repoint.**

What this step is instead: add the remaining generic hooks to `sync-harness.py`'s
`MANIFEST`, each with its test, one at a time. The MANIFEST carries 17 entries today; the
candidates are `enforce-capped-bash.py`, `pretool.py`, `finalize-state.py`,
`enforce-audit-batch-caps.py`, `invoke-capped.py`, `deps-sync.py`, `archive-session*.py`,
and the `.claude → .agents/.codex` mirror scripts that `sync-harness.py`'s own docstring
already flags as "portable but their tests want auditing before vendoring".

For each candidate, in its own commit: read it for project coupling, lift any hardcoded
project value into a `.devkit.toml` field with a neutral default, add the script **and its
test** to the MANIFEST, then run `--check` from every consumer. Never add a script without
its test — a vendored copy has to be verifiable in isolation.

`after-model-edit.py` is never a candidate: it belongs to the Tier-C `add-db-model` skill
that stays in Carameli.

## Step 5 — Wire Carameli to consume it

1. Add `devkit` to `requirements-dev.in` (host/CI tooling — **not** `requirements-test.in`;
   the Docker dev image bakes that lock and must stay slim, per CLAUDE.md).
2. Recompile all three locks in the same commit:
   `python -m uv pip compile --universal --python-version 3.12 …` — `--universal` is
   mandatory or Linux-only packages silently vanish from the container lock.
3. Update `.claude/hooks/session-start.sh` so a fresh clone installs devkit.
4. Update `.vscode/tasks.json` entries to call the console scripts.
5. Update `.pre-commit-config.yaml`'s `sync-agents` hook entry to the new path.
6. **Delete the migrated scripts and their tests from Carameli** — the pip-package ones
   only. **Do not delete anything in the `MANIFEST`**: those files are *supposed* to exist
   in both repos, and removing them from Carameli breaks `sync-harness.py --check` on the
   next PR.
7. **Narrow, do not remove, the `pytest scripts/hooks/tests/` step in the PR Gate
   `backend` job.** The earlier draft said to delete it outright. That is wrong for the
   vendored tier: those tests are the thing that makes a vendored copy verifiable in
   isolation, which is the entire justification for channel 5. Devkit's CI owning a copy
   does not verify *this* repo's copy. Keep the step; scope it to the tests whose subjects
   are still present after the pip migration.

## Tests

- The ~45 migrated test files must pass **unchanged** in devkit's CI. If one needs editing,
  that file was project-coupled — reclassify it to the "stays" bucket instead of weakening
  the test.
- Extend the existing `test_harness_config.py` for the new `[lint]` / `[compose]` tables:
  defaults apply with the tables absent, overrides take effect, and a malformed table still
  falls back rather than raising. Do **not** write a new config-seam test file — the seam
  is one module and should keep one test module.
- Carameli: a test asserting no migrated script path is still referenced anywhere
  (`tasks.json`, workflows, hooks, skills). Grep-based, cheap, catches the classic
  half-finished-move bug. Scope its allowlist to the `MANIFEST`, which is *expected* to
  still be referenced.

## Definition of done

- [ ] Pin-bump mechanism chosen and working (PyPI release or bump workflow) — applies to
      the pip channel only; the vendored tier is pinned by tag in the consumer's CI instead
- [ ] Config seam extends `harness_config.py` / `.devkit.toml`; **no** `[tool.devkit]` table
      and no second config system anywhere
- [ ] Migrated tests green in devkit CI, unmodified
- [ ] Carameli's `scripts/` contains project-specific scripts **plus** the MANIFEST files
- [ ] `src/devkit/` contains no `hooks/` and no `config.py`
- [ ] Hook paths still `${CLAUDE_PROJECT_DIR}/scripts/hooks/*.py`, unchanged by this plan
- [ ] `sync-harness.py --check` green from Carameli after every step of this plan
- [ ] `pytest scripts/hooks/tests/` step still present in the PR Gate, narrowed not deleted
- [ ] Locks recompiled with `--universal`; container lock unchanged in size
- [ ] Fresh clone: session-start installs devkit, `devkit-lint` runs
