# Plan 0 — Cut devkit `v0.5.0`

**Depends on:** nothing. **Blocks:** Plan 2 Step 1, Plan 4 Step 1, and Plan 6.
**Read first:** `docs/plans/active/shared-devkit/README.md`.
**Where the work happens:** mostly in **devkit**, not Carameli.

> **New file, 2026-07-30.** This was a paragraph in the README labelled "the blocking
> prerequisite". Re-auditing devkit showed it is not only a prerequisite — the missing tag
> is actively shipping a broken commit gate into every generated project, so it is a defect
> with a fix, not paperwork. It is small: an afternoon, mostly verification.

## The defect

`scripts/new-project.py` resolves the devkit ref it pins into a generated project:

```python
FALLBACK_DEVKIT_REF = "v0.4.1"
...
args.devkit_ref = latest_devkit_tag() or FALLBACK_DEVKIT_REF
```

Both paths return **`v0.4.1`** — the newest tag is also the fallback. That ref is rendered
into two files in the new project:

1. `.github/workflows/pr-gate.yml` — its drift job checks out devkit at that ref. Harmless
   but stale: it drift-checks a 39-entry manifest against an 18-entry one.
2. `.pre-commit-config.yaml` — which requests `devkit-manifest`,
   `devkit-hooks-stdlib-only`, and `devkit-drift`.

`v0.4.1` is commit `4fbda17`. Verified with `git ls-tree -r --name-only v0.4.1`: that tree
contains **no `.pre-commit-hooks.yaml` and no `scripts/precommit/`**. pre-commit resolves
hook ids strictly, so the new owner's first commit does not skip those three hooks — it
aborts with "hook not found".

devkit knows. `_warn_if_pre_commit_channel_is_unpublished()` calls
`ref_publishes_pre_commit_hooks()` and prints a warning at generation time. A warning is
the right behaviour for a tool that cannot fix the problem itself, and it is why this is a
one-line fix rather than an investigation — but it does not make the generated repo work.

## What the tag also unblocks

Everything the plans depend on landed after `4fbda17`:

| Landed after `v0.4.1` | Needed by |
| --- | --- |
| `.pre-commit-hooks.yaml` + `scripts/precommit/` (3 hooks) | Plan 4 Step 1 |
| `.claude/rules/engineering.md`, `authoring.md` | Plan 2 Step 1 |
| The 10-skill shared instruction tier | Plan 2 Step 1, Plan 1's scope |
| `scripts/hooks/tests/test_repo_contract.py` | Plan 2 Step 1 |
| `sync-agents-context.py` / `sync-codex-hooks.py` + tests | Plan 2 Step 2 (closes two rows) |
| MANIFEST 18 → 39 entries | all of the above |

## Step 1 — Decide whether to fold the rename in

`plan-0b` (README, "Plan 0 — the rename migration") renames `.devkit.toml` →
`.devkit.toml`, `$DEVKIT_DIR` → `$DEVKIT_DIR`, `sync-devkit.py` → `sync-devkit.py`.
It must land atomically across devkit and every consumer, and it ends in a re-tag.

**Recommendation: fold it in, or explicitly defer it forever.** Doing the rename separately
costs a second tag and a second lockstep migration across the same files. Doing it now,
while Carameli is the only consumer and is *already* 21 entries behind — so its vendored
copies are being wholesale replaced anyway — is the cheapest this will ever be. The
alternative is not "do it later"; it is "do it never", which is also a fine answer given
the internal names are load-bearing in a `MANIFEST` compared by path.

Decide before Step 2, because it changes what `v0.5.0` contains. Record the decision here.

- [ ] Decision: fold rename into `v0.5.0` / defer indefinitely — *record it*

## Step 2 — Bump the fallback in the same commit as the tag

`FALLBACK_DEVKIT_REF` must track the newest tag, and devkit already enforces this:
`test_fallback_devkit_ref_tracks_the_newest_tag` fails at release time if a tag lands
without the bump. So the order is:

1. Edit `FALLBACK_DEVKIT_REF = "v0.5.0"` in `scripts/new-project.py`.
2. Run devkit's suites — the fallback test will *still fail* until the tag exists locally.
   That is correct and expected; it is the check working.
3. Commit, tag `v0.5.0`, push both (`git push && git push --tags`).
4. Re-run the suites. Green now that `git describe --tags` can see it.

Do not push the tag before the commit that bumps the fallback — a tag that exists while the
fallback still says `v0.4.1` is the exact state this test was written to catch.

## Step 3 — Verify the tag actually serves the channel

The whole point of the tag is that it carries `.pre-commit-hooks.yaml`. Prove it rather
than assuming:

```bash
git -C /path/to/devkit ls-tree -r --name-only v0.5.0 | grep -E 'pre-commit-hooks|precommit/'
```

Then generate a throwaway project and confirm its commit gate runs:

```bash
python scripts/new-project.py probe_tag --preset bare --parent /tmp/gen \
  --no-remote --no-worktree --yes
cd /tmp/gen/probe_tag && pre-commit run --all-files
```

This is the acceptance test for the defect. It must not print "hook not found", and the
generator must not print the unpublished-channel warning.

> The executable bit matters here and only shows up at this step. The hooks are
> `language: script`, so pre-commit execs them directly — a missing `chmod +x` fails on a
> consumer's machine, after the tag is cut. devkit has a test for it; this run is the
> end-to-end confirmation.

## Step 4b — Activate Carameli's pre-commit channel (Plan 4 Step 1)

**Attempted 2026-07-30 and reverted — it cannot land before the tag.** Adding the block
below and committing produced exactly the defect this plan describes:

```text
[INFO] Initializing environment for https://github.com/alexandrec90/devkit.
error: pathspec 'v0.5.0' did not match any file(s) known to git
```

pre-commit clones the repo at the pinned rev before it can run anything, so a
non-existent tag does not degrade — it aborts the commit outright. Adding the block
now would leave the repo unable to commit at all, which is worse than not having the
hooks. It was therefore reverted rather than forced through with `--no-verify`.

**After Step 4, paste this into the top of `.pre-commit-config.yaml`'s `repos:` list**
(above the existing `- repo: local` entry) and commit:

```yaml
  # --- devkit's published hooks ------------------------------------------------
  # Cheap by design (a TOML parse, an import scan, a byte-compare), so these honour
  # this file's "nothing here may be slow" rule despite not being local.
  #
  # `devkit-drift` is the one that earns its place. `sync-devkit.py --check` resolves
  # its source from $DEVKIT_DIR and exits 0 doing NOTHING when that is unset —
  # indistinguishable from success in a log, which is how the PR gate passed green for
  # months while checking nothing. Through pre-commit there is nothing to configure:
  # the rev is written down here and moved by `pre-commit autoupdate`. Keep the CI
  # `--check` step too; they fail differently, and the CI one survives a bypassed hook.
  - repo: https://github.com/alexandrec90/devkit
    rev: v0.5.0
    hooks:
      - id: devkit-manifest
      - id: devkit-hooks-stdlib-only
      - id: devkit-drift
```

Then verify the gate actually fires, because a gate nobody has seen fail is a gate
nobody knows works: hand-edit a MANIFEST file, confirm the commit aborts on
`devkit-drift`, and revert.

## Step 4 — Bump Carameli's pin

`.github/workflows/pr-gate.yml` line 210 pins `ref: v0.4.1`. Bump it to `v0.5.0` **in the
same commit as Plan 2 Step 1's `--pull`**, never before — the drift check compares the
vendored tree against the checked-out ref, so bumping the ref alone turns a green gate red
by design.

## Tests

- devkit: full suite green after the tag, including
  `test_fallback_devkit_ref_tracks_the_newest_tag`.
- devkit: the `generated-project` CI job green for all five presets — it renders and runs
  each one, so it is what proves the new ref works from the consumer side.
- The Step 3 `pre-commit run --all-files` on a freshly generated project.

## Definition of done

- [ ] Rename decision recorded (Step 1)
- [ ] `FALLBACK_DEVKIT_REF` bumped in the same commit as the tag
- [ ] `v0.5.0` tagged and pushed; `git ls-tree` confirms `.pre-commit-hooks.yaml` present
- [ ] A freshly generated project runs `pre-commit run --all-files` without "hook not found"
- [ ] `new-project.py` no longer warns that the pinned ref cannot serve the hooks
- [ ] devkit CI green, `generated-project` job included
- [ ] Carameli's `pr-gate.yml` `ref:` bump staged for Plan 2 Step 1's commit (not landed alone)
