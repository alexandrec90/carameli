# Plan 2 — Share the rest of `scripts/` (vendored + rendered tiers, **not** a pip package)

**Depends on:** a tagged devkit release carrying the current MANIFEST — see "Prerequisite"
below. Independent of Plan 1.
**Read first:** `docs/plans/active/shared-devkit/README.md`.

> **Reconciled 2026-07-29.** This plan was written against devkit `v0.2.0` and proposed a
> `src/devkit/` pip package with `devkit-lint` / `devkit-test` console scripts. **Upstream
> decided against that**, deliberately and with reasons that also apply here, so the
> package half of this plan is void. What follows is the surviving work, restated against
> what devkit actually is today (HEAD, ahead of `v0.4.1`). Sections that were void are
> called out rather than deleted, so a fresh session does not re-derive the decision.

## The blocking decision is resolved — against this plan's premise

The original blocking decision was *how the pip pin gets bumped* (PyPI vs git-ref vs
manual). It is moot: **there is no pip package and there will not be one.** devkit's
`pyproject.toml` says so explicitly:

```toml
dependencies = []          # stdlib only, "a contract, not an accident"
[tool.uv]
package = false            # "devkit is a virtual project ... not an installable package"
```

There is no `src/devkit/`, no `[project.scripts]`, and no distribution. The reasoning is
the same constraint that already forced the hooks to stay vendored: **anything devkit ships
may need to run before a virtualenv exists**, so a third-party-importable package would
break provisioning on exactly the sessions the harness exists to set up.

Consequences — do not spend time on any of these:

| Void item from the original plan | Why |
| --- | --- |
| PyPI publish / release workflow | No distribution exists |
| Git-ref pin + weekly bump workflow | Nothing to pin |
| `devkit` in `requirements-dev.in`; recompile locks | No package to install |
| `devkit-lint` / `devkit-test` console scripts in `tasks.json` | No entrypoints |
| `.claude/hooks/session-start.sh` installs devkit | It provisions via `uv sync --all-groups` against the *consuming* repo |
| "`src/devkit/` contains no `hooks/` and no `config.py`" | There is no `src/devkit/` at all |

## What replaced it: two sharing tiers, both already working

Scripts are shared by one of two mechanisms. Every classification decision in this plan is
"which tier", not "package or not".

| | **Tier V — vendored** | **Tier R — rendered once** |
| --- | --- | --- |
| Source | `sync-devkit.py`'s `MANIFEST` | `templates/core/scripts/` |
| Delivered by | `sync-devkit.py --pull` | `new-project.py` (new repos only) |
| Kept in sync? | **Yes** — byte-compared, drift fails CI | **No** — project owns it after render |
| Verified by | `sync-devkit.py --check`, `devkit-drift` pre-commit hook | `test_repo_contract.py` asserts the file *exists*, not that it matches |
| Members today | **39 entries** (re-counted 2026-07-30) | `lint-all.py.tmpl`, `run-tests.py.tmpl`, `notify.py`, `notify-wrap.py` |

Tier R is the answer to a question the original plan did not ask: some scripts are
*generically shaped but project-owned* — `lint-all.py` has to know this repo's tool set and
`frontend/` path, `run-tests.py` its compose services. Upstream chose to seed them and let
them diverge, backed by a contract test that they exist, rather than force every project's
tool list through a config seam. **Respect that split**; moving a Tier R script into Tier V
means committing to make it fully config-driven first.

## Prerequisite — devkit must cut a tag → **now `plan-0-cut-the-tag.md`**

This section has been promoted to its own plan file. Summary: devkit's tags still stop at
`v0.4.1` (commit `4fbda17`), which predates the MANIFEST expansion, the shared instruction
tier, and `.pre-commit-hooks.yaml`. Beyond blocking this step, that stale tag is actively
shipping a broken commit gate into every generated project — see Plan 0.

**Do Plan 0 first.** Then bump `pr-gate.yml`'s `ref:` in the same Carameli commit as the
`--pull` below, never in a commit of its own (the drift check compares the vendored tree
against the checked-out ref, so bumping the ref alone turns a green gate red by design).
Never `@main` (README sharp edges).

## Step 1 — Close the 21-entry vendoring gap (highest value, do this first)

> **Re-measured 2026-07-30.** This step said 14 entries against a 32-entry upstream. devkit
> `7d43881` landed a further 7, so the gap is now **21**. Expect it to keep widening while
> this step is deferred — it grew by half in one week.

Carameli's vendored `scripts/sync-devkit.py` carries **18** MANIFEST entries. devkit HEAD
(`2209f61`) carries **39**. Carameli is missing all of these:

```text
# The repo-shape contract
scripts/hooks/tests/test_repo_contract.py

# The shared instruction tier — rules
.claude/rules/engineering.md
.claude/rules/authoring.md

# The shared instruction tier — skills (prose + their vendored helpers/tests)
.claude/skills/ship/SKILL.md
.claude/skills/task/SKILL.md
.claude/skills/retro/SKILL.md
.claude/skills/retro/extract.py
scripts/hooks/tests/test_retro_extract.py
.claude/skills/test-skill/SKILL.md
.claude/skills/test-skill/write-artifacts.py
scripts/hooks/tests/test_write_artifacts.py
.claude/skills/audit-claude-md/SKILL.md
.claude/skills/audit-gitignore/SKILL.md
.claude/skills/audit-dockerignore/SKILL.md

# --- added upstream after the 2026-07-29 audit -------------------------------
# Prose-only skills: their known-fixes.md / state.json stay per-project.
.claude/skills/plan-handoff/SKILL.md
.claude/skills/fix-pre-commit/SKILL.md
.claude/skills/refactor/SKILL.md

# The .claude -> AGENTS.md/.agents/.codex mirror generators + tests.
# These were open questions in Step 2 below. Upstream audited and vendored them.
scripts/sync-agents-context.py
scripts/hooks/tests/test_sync_agents_context.py
scripts/sync-codex-hooks.py
scripts/hooks/tests/test_sync_codex_hooks.py
```

Note what that list is: **10 skills and 2 rules — Plan 1's cargo, arriving through channel
5 instead of a plugin.** See the note at the top of Plan 1; this step is why that plan is
now recommended for closure rather than execution.

### A fourth landmine, specific to the newly-added entries

`sync-agents-context.py` and `sync-codex-hooks.py` are **generators Carameli already runs**
— they are wired as a `repo: local` pre-commit hook (`sync-agents`) and verified by the PR
gate's `mirror-sync` job. Pulling upstream's copies replaces the generator that produces
files the gate then checks. So:

1. Diff both against Carameli's copies **before** the second `--pull`.
2. Regenerate the mirrors and inspect the diff — if upstream's generator emits a different
   `.agents/` shape, `mirror-sync` fails on output nobody edited.
3. `test_sync_agents_context.py` and `test_sync_codex_hooks.py` arrive vendored and must
   pass **unmodified**. Carameli's own `test_codex_hooks_contract.py` is deliberately *not*
   vendored (it pins this repo's exact hook topology) and stays.

### How to run it

**Two `--pull` runs are required.** The tool iterates the `MANIFEST` it was *imported*
with, so the first pull installs the new `sync-devkit.py` and the second copies the
entries that pull added. A single run looks successful and silently moves nothing new.

```bash
DEVKIT_DIR=/path/to/devkit python scripts/sync-devkit.py --pull   # gets the new tool
DEVKIT_DIR=/path/to/devkit python scripts/sync-devkit.py --pull   # gets the new entries
DEVKIT_DIR=/path/to/devkit python scripts/sync-devkit.py --check  # must print 32 in sync
```

### The three landmines in this step

1. **`CLAUDE.md` must cite the vendored rules, not restate them.** Once
   `.claude/rules/engineering.md` lands, `test_repo_contract.py` **fails** on a `CLAUDE.md`
   that reproduces a vendored clause — it matches on the distinctive middle of each
   paragraph, so paraphrasing does not evade it. Carameli's CLAUDE.md currently states its
   own Testing and Tooling sections inline. Rewriting them as citations is real work and
   belongs in this step, not deferred.
2. **The 7 incoming skills overwrite Carameli's copies byte-for-byte.** Diff each one
   *before* the second `--pull` and `--push` anything Carameli should keep (the README's
   guidance: `--push` if this project authored the change, `--pull` to adopt, never
   hand-edit one side). Carameli's `ship`/`task` have `master` written through them;
   upstream's defer to `task_branch.detect_default_branch()` — upstream is correct here,
   adopt it.
3. **`.claude/` is a generated-mirror source.** `sync-agents-context.py` emits `.agents/`
   and `.codex/` from it, and the PR gate's `mirror-sync` job fails on drift. Regenerate
   the mirrors in the same commit, and remember the ordering constraint: the harness
   checkout must stay **after** the `git status --porcelain` step.

## Step 2 — Classify the remaining scripts (replaces the old three-bucket inventory)

Carameli has ~40 scripts in `scripts/`. For each one not already in Tier V or Tier R,
decide its tier. The decision rule:

- **Tier V** if it can be made fully config-driven via `.devkit.toml` *and* it ships
  a test that passes in a repo with a different shape. Vendoring something that reads this
  repo's layout is what made every generated project fail 12 tests on its first CI run.
- **Tier R** if it is generic in shape but must know project specifics that do not reduce
  to a manifest field (tool sets, service names, lockfile names).
- **Stays** if it is Carameli-only.

Candidates, from the original inventory, re-bucketed:

| Script(s) | Tier | Note |
| --- | --- | --- |
| `diagnostics.py`, `extract-log-errors.py` | **V** | The artifact contract every `/fix-*` skill reads. Best remaining V candidate — genuinely shapeless. |
| ~~`sync-agents-context.py`, `sync-codex-hooks.py`~~ | **DONE** | ~~audit their tests before vendoring~~ — **upstream did the audit and vendored both, with tests, in `7d43881`.** They now arrive in Step 1. Nothing to decide. |
| `script_common.py`, `lint-instructions.py`, `archive-done-todos.py` | **V** | Verify no path assumptions first. |
| `lint-all.py`, `run-tests.py` | **R** | Already Tier R upstream. Do **not** promote — Carameli's versions know its tool set and compose services. |
| `docker_common.py`, `docker_win.py`, `docker-*.py` | **R** | Compose service names and the telephony profile are Carameli's. |
| `run-ci.py`, `run-e2e.py`, `run-load.py`, `run-mutation.py` | **R** | Thin wrappers over project-specific suites. |
| `recompile-locks.py`, `check-lock-markers.py`, `venv-install.py` | **Stays** | Carameli is `requirements*.in`-based; devkit is uv-native. `test_repo_contract.py` already treats `check-lock-markers.py` as an optional tier for exactly this reason. |
| `ship.py`, `start-task.py`, `pre-commit.py`, `install-pre-commit.py` | **V** | Pair with the already-vendored `task_branch.py`. |
| `start-ngrok.py`, `sync-sandbox-secrets.py`, `backup_restore_test.py`, `compress-*`, `gen-eval-fixture.py` | **Stays** | Project-specific, as originally classified. |

Work one script + its test per commit, running `--check` from Carameli after each. Never
add a script to the MANIFEST without its test — a vendored copy has to be verifiable in
isolation.

## Step 3 — The config seam (unchanged, but verify before extending)

Still correct and still the answer: `scripts/hooks/harness_config.py` reading
`.devkit.toml`. Do **not** build a `[tool.devkit]` table in `pyproject.toml`.

Two updates since the plan was written:

- The `[lint]` / `[compose]` tables this plan proposed may already exist upstream, and
  `.devkit.toml` has grown `[paths]`, `[db]`, `[frontend]`, and
  `[stop] finalize_targets`. **Read devkit's `templates/core/dot-devkit.toml.tmpl`**
  — the canonical example — before adding a field.
<!-- cspell:ignore servce -->

- Unknown keys are now caught. `check_harness_manifest.py` (pre-commit) and
  `test_repo_contract.py` both reject them, because `from_dict` is all
  `raw.get(name, default)`, so a typo like `db_servce` reads as "unset" and silently falls
  back to a default that does not match the compose file. Adding a field means adding it to
  the validator's known-key set too.

Keep extending `test_harness_config.py`; do not start a second config-seam test module.

## Step 4 — What explicitly does not move

- **Hook bodies** stay in `scripts/hooks/` at `${CLAUDE_PROJECT_DIR}` paths. Settled twice
  over (README "Why hooks stay vendored"); nothing in this plan repoints them.
- **`.devkit.toml`** is never in the MANIFEST — per-project config.
- **`pytest scripts/hooks/tests/`** stays in the PR gate `backend` job, narrowed not
  deleted. Devkit's CI owning a copy does not verify *this* repo's copy, which is the whole
  justification for the vendored tier. The step gets *larger* after Step 1, not smaller —
  three new vendored tests arrive with it.
- **`after-model-edit.py`** belongs to the Tier-C `add-db-model` skill. Never a candidate.

## Tests

- After Step 1: `pytest scripts/hooks/tests/` green with the **five** new vendored test
  files (`test_repo_contract`, `test_retro_extract`, `test_write_artifacts`,
  `test_sync_agents_context`, `test_sync_codex_hooks`), **unmodified**. If one needs editing
  to pass here, it is project-coupled — report it upstream rather than weakening it locally.
- `sync-devkit.py --check` prints "all 39 vendored files in sync" and **not** "nothing to
  do (skipping)". That line means the gate is inert — fix the wiring, never ignore it.
- Extend `test_harness_config.py` for any new manifest table: defaults apply when absent,
  overrides take effect, malformed falls back rather than raising.
- A Carameli test asserting no migrated script path is still referenced from `tasks.json`,
  workflows, hooks, or skills — allowlisting the MANIFEST, which is *expected* to still be
  referenced. Grep-based; catches the half-finished-move bug.
- `mirror-sync` green after `.claude/` changes in Step 1.

## Definition of done

- [ ] Plan 0 done (devkit tagged `v0.5.0`); Carameli's `pr-gate.yml` `ref:` bumped to match
      in the same commit as the `--pull`
- [ ] MANIFEST gap closed: `--check` reports 39/39 in sync from Carameli
- [ ] `.agents/` mirror regenerated with *upstream's* `sync-agents-context.py`;
      `mirror-sync` green on the regenerated output
- [ ] Carameli's `CLAUDE.md` **cites** `.claude/rules/engineering.md` and `authoring.md`
      instead of restating them; `test_repo_contract.py` green
- [ ] The 7 incoming skills diffed before adoption; anything Carameli authored `--push`ed
      upstream rather than hand-merged
- [ ] `.agents/` and `.codex/` mirrors regenerated; `mirror-sync` green
- [ ] Every remaining script in `scripts/` has an explicit tier (V / R / stays), recorded in
      this file
- [ ] `diagnostics.py` + `extract-log-errors.py` vendored with tests, `--check` green
- [ ] `pytest scripts/hooks/tests/` step still present in the PR gate, widened for the new
      vendored tests
- [ ] No `[tool.devkit]` table and no second config system anywhere
- [ ] Hook paths still `${CLAUDE_PROJECT_DIR}/scripts/hooks/*.py`, unchanged by this plan

**Deliberately not in scope any more:** PyPI, a `devkit` pip dependency, console scripts,
lock recompilation for devkit, `src/devkit/`.
