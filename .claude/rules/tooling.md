---
description: VS Code task scripts and PowerShell conventions for Windows
paths:
  - scripts/**/*.ps1
  - .vscode/tasks.json
---

# Rule: Tooling Conventions

## Task Scripts (VS Code)

- **Always use PowerShell (`.ps1`) for VS Code task scripts** — not Bash or `.sh` files.
- The host OS is Windows 11. `.sh` scripts require Git Bash and are not reliably portable.
- Use `"type": "process"` tasks in `tasks.json` so VS Code monitors the pwsh
  process directly (not wrapped in a bash shell). This ensures the task spinner
  stops and the exit-code icon (green checkmark / red X) appears reliably.
  ```jsonc
  { "type": "process", "command": "pwsh", "args": ["-ExecutionPolicy", "Bypass", "-File", "scripts/your-script.ps1"] }
  ```
- Set `"close": false` in `presentation` so the terminal stays open for review
  after the task finishes.
- Store all task helper scripts under `scripts/` in the workspace root.

## PowerShell Scripting (Windows Pitfalls)

- **`docker compose exec` must use `-T`** in scripts — without it, a pseudo-TTY is
  allocated and the ConPTY handle can outlive the command, keeping `pwsh.exe` alive
  after the script finishes. VS Code will show the task as still running.
- **Use `exit N` instead of `[Environment]::Exit(N)`** at the end of scripts —
  `[Environment]::Exit()` hard-kills the .NET runtime and bypasses PowerShell's
  normal shutdown, which can prevent VS Code from detecting the process exit.
  `exit` does a clean teardown that `"type": "process"` tasks reliably detect.
- **ASCII only in `.ps1` files** — no em-dashes, curly quotes, or other non-ASCII
  characters. They cause parse errors when file encoding is misread.
- **Use `pwsh`** (PowerShell 7), never `powershell` (Windows PowerShell 5.1).
