---
description: Script and tooling conventions for VS Code tasks, CI, and hooks
paths:
  - scripts/**/*.py
  - .vscode/tasks.json
  - .github/workflows/*.yml
---

# Rule: Tooling Conventions

## Scripts

All new scripts under `scripts/` are written in Python for cross-environment
compatibility (local Windows desktop and GitHub Actions).

- **Expose pure importable functions** guarded by `if __name__ == '__main__'` so pytest
  can test the logic without spawning a subprocess.
- **Write pytest tests** in `scripts/hooks/tests/` using the `load_module()` helper in
  `conftest.py` (handles non-standard filenames via `importlib.util`).
- Every new script must ship with tests in the same change.
- **Handle CLI args strictly**: `-h`/`--help` must print usage and exit, and an
  unrecognized argument must error out (exit 2) — never fall through to the
  script's default action (`run-tests.py --help` once silently started a full
  suite run).

### Hook scripts (`scripts/hooks/`)

- **stdlib only** — no third-party packages. Hooks run before the virtualenv is activated.
- `scripts/hooks/tests/` is excluded from the app test suite automatically because
  `pytest.ini` sets `testpaths = tests`.

#### Capping Bash output (`enforce-capped-bash.py`)

The PreToolUse hook blocks any Bash call whose output isn't byte-capped. Exactly two
forms pass its `ALLOWED_PATTERNS`, and **they don't run in the same shell** — pick
deliberately:

| Form | Shell | Exit code |
| --- | --- | --- |
| `python3 scripts/hooks/invoke-capped.py --command "…" --max-bytes 4000` | `cmd.exe` (Windows) | preserved |
| `<command> \| head -c 4000` | Git Bash | **masked** — the pipeline reports `head`'s status |

- `invoke-capped.py` shells out with `subprocess.run(command, shell=True)`, which on
  Windows is **`cmd.exe`** — not the Git Bash the Bash tool otherwise gives you. Heredocs
  fail (`<< was unexpected at this time`), and single-quoted paths arrive with the quotes
  intact (`git commit -F 'C:/…/msg.txt'` → `could not read log file ''C:/…''`). Use
  unquoted forward-slash paths, and avoid paths containing spaces.
- `| head -c <N>` runs in Git Bash, so POSIX syntax works — **use it when the command needs
  a heredoc or quoting `cmd.exe` would mangle**, e.g. `git commit -F - <<'EOF' … EOF | head -c 4000`.
  Two costs: the pipeline's exit code is `head`'s, not the command's (add `set -o pipefail`
  when you need to branch on failure), and only stdout is piped, so stderr escapes the cap.
- Neither form makes a command interactive-safe. Anything that would open an editor or
  prompt still needs its non-interactive flag (`-F <file>`, `--no-edit`, `--quiet`).

### Portable agent harness (`.devkit.toml` + `scripts/sync-devkit.py`)

The hook scripts are designed to be **vendored unchanged across projects**. Anything
project-specific lives in `.devkit.toml` at the repo root, read by
`scripts/hooks/harness_config.py` (stdlib `tomllib`, never raises — a missing/bad
manifest falls back to neutral defaults).

- **Never hard-code project specifics in a hook script.** Env-var prefix, DB
  creds/ports/service names, the frontend layout, the `app/`/`tests/` shape, and the
  Stop-hook `finalize_targets` all come from `Config` (see `stop.py`'s `CFG`). New
  project-specific behaviour gets a manifest field + a `harness_config` default, not an
  `if project == …` branch.
- **The shared harness repo is the source of truth; each project commits a vendored
  copy.** It is [`alexandrec90/devkit`](https://github.com/alexandrec90/devkit) — renamed
  from `agent-harness` on 2026-07-25, with the **internal** names migrated to match on
  2026-07-30: `.devkit.toml`, `$DEVKIT_DIR`, `DEVKIT_VERSION`, `sync-devkit.py`, and the
  published pre-commit hook ids `devkit-manifest` / `devkit-hooks-stdlib-only` /
  `devkit-drift`. That had to be one atomic change across devkit and every consumer,
  because `sync-devkit.py` is itself in the `MANIFEST` and the drift check compares by
  path. Any surviving `agent-harness` spelling is a miss, not a holdout — fix it.
  `scripts/sync-devkit.py` manages the copy: `--check` (drift-fails, wired into the
  PR-gate `mirror-sync` job), `--pull` (adopt upstream), `--push` (author a change / seed
  the shared repo). The shared-repo path comes from `--src` or `$DEVKIT_DIR`.
  `DEVKIT_VERSION` records which upstream commit the vendored copy corresponds to; it is
  written by `--pull` and must match the tag `pr-gate.yml` pins.
  The vendored file set is `sync-devkit.py`'s `MANIFEST` — extend it as more scripts are
  decoupled; `.devkit.toml` is deliberately **not** in it (it is per-project config).
- **Every mode no-ops clean (exit 0) when `$DEVKIT_DIR` is unset.** That is correct
  pre-adoption behaviour and a trap afterwards: the PR gate called `--check` for months
  without setting the variable, so it passed green while checking nothing, and was hiding
  real drift. The gate now checks the harness out itself (public repo, pinned tag) and sets
  the variable. **If you ever see `--check` print "nothing to do (skipping)" in CI, the
  gate is inert — fix the wiring, don't ignore the line.**
- **When authoring a harness change, pick a direction deliberately.** `--push` if this
  project authored it (e.g. Carameli's `# pragma: allowlist secret` comments, which exist
  because this repo runs detect-secrets and the harness does not — harmless upstream,
  required here). `--pull` to adopt upstream. Never hand-edit one side to match the other:
  that resolves the symptom and loses the provenance.
- **The harness checkout must come *after* any `git status --porcelain` step** in the same
  job. It lands an untracked `.devkit-src/` in the workspace, which the `mirror-sync`
  drift check would otherwise report as stale mirrors.
- This is the same single-source→committed-mirror pattern as `.claude/` →
  `.agents/`/`.codex/`, lifted from intra-repo to cross-repo.

### VS Code tasks

- Use `"type": "process"` tasks in `tasks.json` so VS Code monitors the process
  directly. This ensures the task spinner stops and the exit-code icon appears reliably.
- Set `"close": false` in `presentation` so the terminal stays open for review.
- **Wrap with `notify-wrap.py` for Windows toast notifications** — never call
  `notify.py` from inside a script. Notifications are a task-layer concern only:

  ```jsonc
  { "command": "python", "args": ["scripts/notify-wrap.py", "Task Name", "--", "python", "scripts/your-script.py"] }
  ```

### Failure artifacts (fix from a file, not from the terminal)

Any task or script whose failures a coding agent is expected to act on must persist the
actionable failure to a **parseable artifact file** — never rely on streamed terminal
output, which scrolls away and buries the signal in noise. Keep the terminal quiet (a
short status line plus the artifact path); put everything needed to diagnose and fix in
the file.

- Follow the artifact format and lifecycle in `.claude/rules/diagnostics.md`
  (self-locating error lines, strip noise, overwrite per run, `# source:` header).
- Write the artifact on **failure too**, not just success — capture stdout/stderr to the
  file rather than leaving the process on `stdio: 'inherit'` with nothing saved.
- This is not limited to the lint/test diagnostic scripts. It applies to any long-running
  task in `tasks.json`, including the promptfoo eval drivers
  (`eval:ablate` / `eval:rewrite` / `eval:section`), which currently stream to the terminal
  and leave no artifact when a run errors before promptfoo writes its output.

### Docker subprocess calls

- **`docker compose exec` must use `-T`** — without it a pseudo-TTY is allocated and
  the subprocess handle can outlive the command, leaving the calling process hung.

## GitHub Secrets and Variables

When a workflow references `${{ secrets.* }}` or `${{ vars.* }}`, use the `gh` CLI
to create or update the value — do not ask the user to use the GitHub web UI.
`gh` is installed, authenticated as `alexandrec90`, with `repo` + `workflow` scopes.

## CI feedback loop (don't diagnose the gate one round at a time)

The PR Gate `lint` job runs `scripts/lint-all.py` — the same entrypoint available
locally. Use it as a pre-flight, not a remote oracle:

- **Run `python scripts/lint-all.py` before pushing a branch the gate will lint.**
  One local pass surfaces every ruff/mypy/eslint/stylelint/dotenv failure at once;
  discovering them one CI round at a time burns gate runs and wall-clock. The
  SessionStart hook (`.claude/hooks/session-start.sh`) provisions the toolchain so
  this works in a fresh web sandbox — if a tool is missing, fix the hook, don't skip
  the check.
- **A full run auto-fixes on disk, so expect a dirty tree afterwards.** `ruff`,
  `eslint`, `stylelint`, and `markdownlint` all run with `--fix` before the reporting
  pass (see `.claude/rules/diagnostics.md`, "Auto-fix before reporting"), so `git status`
  after a full run shows real edits, not noise. **`ruff format` also formats Python code
  blocks inside Markdown** (ruff ≥ 0.16), which means instruction files, `SKILL.md`s, and
  plan docs get reformatted too — the first full run after a ruff bump can touch dozens of
  `.md` files that no one edited. Review and commit those; don't revert them and don't
  assume the tree was already clean. `--changed` scopes the fixers to the working-tree
  diff and is the safer pre-flight mid-task.
- **When a gate job fails, read the filtered artifact, not the raw job log.** The
  `lint` and test jobs upload `logs/lint-errors.log` / `logs/test-failures.log` —
  pre-filtered to actionable lines (see `.claude/rules/diagnostics.md`). A raw CI job
  log buries the real error under ~1000 lines of Postgres/Redis container boot noise;
  reading it wastes context. If you must read a job log, request a small tail window.
- **When polling a PR for merge, keep the check to one line of git** (e.g.
  `git fetch -q && git merge-base --is-ancestor <sha> origin/master`) rather than
  refetching the full PR object or job logs each cycle.
- **Batch autofixes into one push.** Every push re-runs the full PR Gate, so fix
  *all* failures the filtered artifact lists in a single round, then push once —
  not one push per fix. The Stop hook's local re-verify before that push makes the
  fix more likely complete, cutting follow-up rounds.
- **Right-size the model for the autofix loop (opt-in).** The loop's cost is
  dominated by re-loaded context per round, and trivial CI fixes (a lint nit, a
  missing import, a snapshot update) don't need Opus/high-effort. When the failure
  is clearly mechanical, running the autofix turn at a lower model/effort cuts token
  cost with no quality loss; reserve the full model for failures that need real
  diagnosis. This is a judgement call per failure, not a hard switch — the default
  config (`.claude/settings.json`) stays on the capable model.
