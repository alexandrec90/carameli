# Plan 6 — What Carameli still owns that devkit should have

**Depends on:** Plan 2 Step 1 (the `--pull` changes what is left to extract).
**Read first:** `docs/plans/active/shared-devkit/README.md`.
**Where the work happens:** devkit for items 1–3, Carameli for the `--push`.

> **New file, 2026-07-30.** The existing plans move *known* assets along *named* channels.
> This one is the opposite direction: an audit of Carameli's `scripts/`, `scripts/hooks/`,
> and `.claude/` against devkit HEAD, asking what is generic and still un-shared. It found
> one genuine defect in devkit and four strong candidates.
>
> **Item 1 is not a nice-to-have — it is a broken contract in devkit's shipped tier.** It
> can be fixed independently of everything else in this plan set, including Plan 0.

---

## Item 1 — devkit's vendored `stop.py` dispatches to three scripts devkit does not ship

**Severity: high. This is a live incoherence in the vendored tier, not an extraction
opportunity.**

devkit's `scripts/hooks/stop.py` — vendored, in the MANIFEST — resolves and spawns:

```python
FINALIZE_STATE        = REPO_ROOT / "scripts/hooks/finalize-state.py"
NORMALIZE_KNOWN_FIXES = REPO_ROOT / "scripts/hooks/normalize-known-fixes.py"   # ✅ vendored
ARCHIVE_SESSION       = REPO_ROOT / "scripts/hooks/archive-session.py"
```

And its vendored `test_repo_contract.py` **hard-requires** one of them:

```python
def test_finalize_state_present_when_the_manifest_names_targets():
    if not CFG.finalize_targets:
        pytest.skip("no [stop] finalize_targets configured")
    assert hook.FINALIZE_STATE.exists(), ...
```

Verified by `Glob` over the whole devkit tree: **`finalize-state.py`, `archive-session.py`,
and `state-tools/state-engine.py` do not exist anywhere in devkit** — not in `scripts/`,
not in `MANIFEST`, not in `templates/`. Only Carameli has them.

### Why this matters

The consequence is precisely the failure mode devkit's own README says the repo contract
exists to prevent — *"the runtime degrades quietly, CI is where that gets noticed"*:

- A generated project that adopts any state-carrying skill sets `[stop] finalize_targets`
  and **immediately fails its own contract test**, with nothing in devkit that can satisfy
  it. The test's message ("names N target(s) but scripts/hooks/finalize-state.py is
  missing") points at a file the project has no way to obtain.
- Until then it is worse than a failure: `stop.py` sends both streams to `DEVNULL` and
  never reads the exit code, so a missing `archive-session.py` means session archiving
  silently never happens. The test docstring calls this "the quietest failure in the
  harness" — and devkit is currently the repo causing it.
- The template ships `finalize_targets = []` with a comment explaining an entry naming a
  non-existent skill is useless. That is a workaround for the missing script, not a design.

### Options

| Option | Cost | Verdict |
| --- | --- | --- |
| **(a) Vendor the three scripts** (`finalize-state.py`, `archive-session.py`, plus `state-tools/state-engine.py` as the engine the first is a thin wrapper over) | Medium — `state-engine.py` is a real component and needs its schemas checked for Carameli coupling | **Recommended.** It makes `stop.py`'s dispatch honest and unlocks the state-carrying skills already vendored (`refactor` ships a `state.json` seed today with no engine to read it) |
| **(b) Make them explicitly optional** — early-return in `stop.py`, `pytest.skip` in the contract test, documented as project-supplied | Low | Acceptable stopgap, but it *documents* the gap rather than closing it, and leaves `refactor`'s vendored state seed inert |
| **(c) Leave as-is** | Zero | No — a shipped test that cannot pass is worse than no test |

Note the ordering argument for (a): devkit **already vendors `refactor/SKILL.md` and seeds
an empty `state.json`**, so it has already committed to the state mechanism in the
instruction tier while omitting the engine that drives it. (a) finishes a job already begun.

Carameli's copies to `--push` upstream: `scripts/hooks/finalize-state.py`,
`scripts/hooks/archive-session.py`, `.claude/skills/state-tools/state-engine.py`, and the
tests `test_finalize_state.py`, `test_archive_session_*.py` (4 files).

**Check first:** `state-engine.py`'s schemas are `("audit", "modules", "files")`, and
Carameli's `finalize_targets` names `audit-design-flaws`, `make-tests`,
`make-frontend-tests`, `refactor` — all Tier-C or Carameli-specific *skills*, but the
*schemas* are generic. Vendor the engine and the schemas; the target list stays in
`.devkit.toml` where it already is. That split is what makes this portable.

---

## Item 2 — `enforce-capped-bash.py` + `invoke-capped.py`

**Recommendation: vendor. Highest generic value of anything Carameli still owns.**

A `PreToolUse` hook that blocks Bash calls lacking an output byte-cap wrapper, plus the
wrapper itself. Read both: they are already written the way the vendored tier requires —
stdlib only, pure decision functions (`decide`, `is_capped`, `get_value`) exposed for unit
testing, and an explicit comment about the hook exit contract (`0` allow / `2` block, reason
on stderr, "every other non-zero code is reported as a non-blocking hook *error* and the
tool call proceeds anyway").

Zero project coupling — the only tunable is `DEFAULT_MAX_BYTES = 4000`, which is exactly the
kind of thing `.devkit.toml` exists for (`[bash] max_bytes`).

Why this one first: it directly serves the standing token-quota constraint, and unlike most
harness utilities its benefit is immediate and per-turn rather than per-release. Every
project gets it for free once vendored.

Bring `test_enforce_capped_bash.py` and `test_invoke_capped.py` with it. Also consider
vendoring `test_hook_exit_contract.py` — it asserts the `0`/`2` convention across *all*
hooks, which is a property of the harness itself, not of Carameli.

---

## Item 3 — `pretool.py` (the PreToolUse dispatcher)

**Recommendation: vendor the dispatcher, keep the children project-owned.**

`pretool.py` is a dispatcher that chains PreToolUse children and propagates the child's exit
code verbatim. Its own logic is portable and its marker selection is already factored as a
pure function (`select_marker_scripts`). Its *children* — `enforce-audit-batch-caps.py`
(bound to the Tier-C `audit-design-flaws` skill) — are not.

This is the same shape as `stop.py`, which devkit already vendors as a dispatcher over
optional project-owned children. Follow that precedent exactly: dispatcher in the MANIFEST,
child list in `.devkit.toml`, missing child skips explicitly rather than erroring.

**Do not repeat Item 1's mistake while fixing it**: if `pretool.py` is vendored, every child
path it names must either ship with it or be gated on a manifest field. That is the whole
lesson of this plan.

---

## Item 4 — `diagnostics.py` + `extract-log-errors.py`

**Already Plan 2 Step 2's top Tier-V candidates. Still correct; nothing has changed.**

Listed here only so this document is a complete inventory. Execute them from Plan 2.

One addition the audit surfaced: these are the reason `fix-all` and `fix-lint` are
*deliberately not vendored* upstream (devkit README — the dispatchers would dead-end because
their children don't ship). **Vendoring `diagnostics.py` weakens that argument.** If the
artifact contract ships, the case for shipping the fixer skills that read it gets stronger —
which is the one path by which Plan 1 could become worth reopening. Note it; do not act on
it until `diagnostics.py` is actually upstream and proven portable.

---

## Item 5 — Codex support is half-vendored

devkit vendors `sync-codex-hooks.py` (regenerates `.codex/hooks.json` from
`settings.json`). Carameli additionally has `scripts/hooks/codex-hook-adapter.py` and
`scripts/hooks/codex-session-start.py` — the pieces that make the generated
`.codex/hooks.json` *execute*.

So a generated project can produce a `.codex/hooks.json` naming an adapter it does not have.
Milder than Item 1 (the generator "only fires in a repo that has a `.codex/` directory", so
it is inert by default), but the same shape: ship the generator, omit the runtime.

**Recommendation: audit these two for coupling, then vendor or explicitly document as
project-supplied.** Carameli's `test_codex_hooks_contract.py` stays put — upstream has
already recorded that it pins this repo's exact hook topology and must not be vendored.

---

## Deliberately not recommended

Recorded so a later session does not re-derive them:

| Asset | Why it stays in Carameli |
| --- | --- |
| `deps-sync.py`, `recompile-locks.py`, `check-lock-markers.py`, `venv-install.py` | pip-tools / `requirements*.in`. Generated projects are uv-native. `test_repo_contract.py` already treats `check-lock-markers.py` as an optional tier for this reason. |
| `docker_common.py`, `docker_win.py`, `docker-*.py` (7 scripts) | Compose service names and the telephony profile are Carameli's. Tier R at best. |
| `run-ci.py`, `run-e2e.py`, `run-load.py`, `run-mutation.py` | Thin wrappers over project-specific suites. |
| `enforce-audit-batch-caps.py` | Bound to the Tier-C `audit-design-flaws` skill. Stays even if `pretool.py` is vendored (Item 3). |
| `start-ngrok.py`, `sync-sandbox-secrets.py`, `backup_restore_test.py`, `compress-*`, `gen-eval-fixture.py` | Project-specific, as originally classified. |
| `.claude/rules/skin-*.md` (5), `voip-providers.md`, `webhooks.md`, `database.md`, `logging-backend.md`, `vanillaland-paths.md` | Carameli's stack. Upstream is explicit: "A rule naming one project's services, paths, or default branch is that project's own." |
| The `known-fixes.md` / `state.json` **corpora** | README, "Explicitly out of scope". Share the format, never the content. |

## Sequencing

1. **Item 1** — independent of everything, fixes a real defect. Do it whenever.
2. **Plan 0**, then **Plan 2 Step 1** — after the pull, re-run this audit; Carameli's
   `scripts/hooks/` will have changed underneath it.
3. **Item 2**, then **Item 3**, then **Item 5**. One script + its test per commit, with
   `sync-devkit.py --check` run from Carameli after each — the README's standing rule.
4. **Item 4** from Plan 2.

## Definition of done

- [ ] Item 1 resolved by option (a) or (b), and `stop.py`'s three dispatch targets either
      all ship or are all explicitly optional
- [ ] A devkit test asserting every path `stop.py` and `pretool.py` dispatch to is either in
      the MANIFEST or gated on a manifest field — the generalisation of Item 1
- [ ] `enforce-capped-bash.py` + `invoke-capped.py` vendored with tests; `[bash] max_bytes`
      in `harness_config.py` with a neutral default
- [ ] Every remaining Carameli script has a recorded verdict (vendor / render / stays)
- [ ] `sync-devkit.py --check` green from Carameli after each addition
