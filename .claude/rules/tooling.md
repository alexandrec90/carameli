---
description: Script and tooling conventions for VS Code tasks, CI, and hooks
paths:
  - scripts/**/*.py
  - scripts/**/*.ps1
  - .vscode/tasks.json
  - .github/workflows/*.yml
---

# Rule: Tooling Conventions

## Scripts

All new scripts under `scripts/` are written in Python for cross-environment
compatibility (local Windows desktop, GitHub Actions, web, and mobile sessions).

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

### Docker subprocess calls

- **`docker compose exec` must use `-T`** — without it a pseudo-TTY is allocated and
  the subprocess handle can outlive the command, leaving the calling process hung.

## GitHub Secrets and Variables

When a workflow references `${{ secrets.* }}` or `${{ vars.* }}`, use the `gh` CLI
to create or update the value — do not ask the user to use the GitHub web UI.
`gh` is installed, authenticated as `alexandrec90`, with `repo` + `workflow` scopes.
