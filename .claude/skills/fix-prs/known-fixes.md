# Known PR Fixes

Quick-lookup table for recurring PR-failure classes. When a failing PR's signature matches a
pattern below, apply the documented action directly instead of investigating from scratch.

<!-- Keep patterns as plain substrings — no regex needed. -->
<!-- One row per distinct failure/label pattern. Prune entries that stop recurring. -->
<!-- Hits/Last used are updated by the fix-prs skill each time a pattern matches. -->
<!-- Entries with 0 hits after 90+ days from Added date can be pruned. -->

| Error pattern (substring) | Root cause | Fix | Hits | Last used | Added |
|---|---|---|---|---|---|
| `Lockfile environment markers` (job) / `check-lock-markers` | Dependabot pip bump rewrote `requirements*.txt` with bare pins, stripping the `; python_version`/`; sys_platform` markers the `uv --universal` compile emits | Recompile the locks (never hand-edit them): `python -m uv pip compile --universal --python-version 3.12 requirements.in -o requirements.txt`, then `-test` with `-c requirements.txt`, then `-dev` with `-c requirements-test.txt`; commit the result. See the `dependabot-strips-lock-markers` memory. | 0 | — | 2026-07-13 |
| `needs-manual-merge` (label) | Runtime-major Dependabot bump the repo policy holds for human review | Fix to green if failing, but **do not merge** — report it to the user as ready for review (Hard Rule 2). | 0 | — | 2026-07-13 |
| `mergeStateStatus` `BEHIND` / merge conflict with master | PR branch is behind master and the gate/merge is blocked | Update the branch: `gh pr update-branch <N>` (or check out, merge `origin/master`, resolve, push). Re-run the gate. | 0 | — | 2026-07-13 |
| `This branch has no conflicts` but gate never ran / no checks | PR Gate didn't dispatch (e.g. first-time contributor, or a Dependabot-token run) | Re-trigger: push the fix commit (an empty commit if only re-running), or `gh workflow run "PR Gate"` on the branch. | 0 | — | 2026-07-13 |
