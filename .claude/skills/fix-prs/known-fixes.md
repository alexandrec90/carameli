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
| `pip-audit` block in `lint-errors.log` (`Found N known vulnerabilit`) | A pinned lock version picked up a new advisory (PYSEC/CVE published after the last compile) | Recompile the locks with only that package bumped: `python -m uv pip compile --universal --python-version 3.12 requirements.in -o requirements.txt -P <pkg>`, then `-test` with `-c requirements.txt -P <pkg>`, then `-dev` with `-c requirements-test.txt -P <pkg>`; `pip install <pkg>==<new>` to sync the venv, rerun `lint-all.py --changed`, commit. If the flagged package is in **no** lockfile it's local venv drift — upgrade it locally, nothing to commit. | 1 | 2026-07-15 | 2026-07-15 |
| `needs-manual-merge` (label) | Runtime-major Dependabot bump the repo policy holds for human review | Fix to green if failing, but **do not merge** — report it to the user as ready for review (Hard Rule 2). | 1 | 2026-07-17 | 2026-07-13 |
| Lint job failed but the `lint-errors` artifact is **empty** | The failure is the `Fail on uncommitted auto-fixes` step, not a linter: committed files need a ruff-format/auto-fix pass, and those diffs never land in `lint-errors.log` (confirm via the job's step list: `gh api .../actions/jobs/<id> --jq '.steps[]'`) | Check out the PR branch, run `python scripts/lint-all.py --paths <changed files>` — it applies the auto-fixes to the tree — then commit the resulting diff. | 1 | 2026-07-17 | 2026-07-17 |
| `mergeStateStatus` `BEHIND` / merge conflict with master | PR branch is behind master and the gate/merge is blocked | Update the branch: `gh pr update-branch <N>` (or check out, merge `origin/master`, resolve, push). Re-run the gate. | 0 | — | 2026-07-13 |
| `This branch has no conflicts` but gate never ran / no checks | PR Gate didn't dispatch, **or** the pull_request run is stuck at `action_required` awaiting approval (Dependabot/first-time actor) | First check `gh run list --workflow "PR Gate" --branch <head>`: a run with conclusion `action_required` needs `gh api repos/<owner>/<repo>/actions/runs/<id>/approve -X POST` — a `gh workflow run` dispatch does NOT attach checks to the PR. Only if no run exists at all, re-trigger via an empty-commit push or `gh workflow run "PR Gate"`. | 1 | 2026-07-17 | 2026-07-13 |
