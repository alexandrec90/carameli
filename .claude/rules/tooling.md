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

### Hook scripts (`scripts/hooks/`)

- **stdlib only** — no third-party packages. Hooks run before the virtualenv is activated.
- `scripts/hooks/tests/` is excluded from the app test suite automatically because
  `pytest.ini` sets `testpaths = tests`.

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
