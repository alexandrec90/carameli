---
description: Design rules for diagnostic scripts that produce log artifacts for AI-agent consumption
paths:
  - scripts/**/*.ps1
---

# Rule: Diagnostic Script Design

Scripts in `scripts/` produce log artifacts in `logs/` that are consumed by coding-agent
skills (`fix-lint`, `fix-tests`, `fix-pre-commit`, `fix-docker`). Every design decision
in these scripts must prioritize: **Can an AI agent read this log and fix the problem
without asking questions?**

## 1. Every error line must be self-contained

Each error line in the log must include enough context to act on it in isolation:

- **File path** -- absolute or repo-relative (never omitted)
- **Line and column** -- `file:line:col` when the tool supports it
- **Error code / rule ID** -- so the agent can look up the rule
- **Message** -- the actual problem description

Prefer machine-parsable output formats when the tool offers them (e.g. `yamllint -f parsable`,
`ruff --output-format=full`, `eslint -f unix`, `mypy --show-error-codes`). If a tool emits
file paths on separate header lines (not on each error line), either switch to a parsable
format or ensure the filter preserves the header lines.

## 2. No noise -- only actionable content

Strip everything an agent cannot act on:

- **Library / framework internals** in tracebacks -- keep only frames in `app/`, `tests/`,
  or first-party code. A 128-line SQLAlchemy traceback is noise; the one `app/` frame
  and the final exception line are the signal.
- **npm / pip / tool boilerplate** -- "npm warn", "> script-name", blank lines, "Found N errors"
  summary lines (the individual errors are already listed).
- **Passing results** -- only write failures to the artifact. Pass status belongs in terminal
  output, not the log file.
- **INFO/DEBUG log captures** from test output -- keep WARNING/ERROR/CRITICAL only.

## 3. Classify failures: code error vs environment vs auto-fixed

Not all failures are code errors. The script must distinguish:

| Classification | What it means | Artifact behavior |
|---|---|---|
| **code error** | Lint violation, type error, test failure | Write full detail to artifact |
| **environment error** | DB unreachable, auth failure, timeout, service down | Skip with reason -- do not write to artifact |
| **tool missing** | Linter not installed, command not found | Skip with reason -- do not write to artifact |
| **auto-fixed** | Tool fixed the issue on disk (ruff --fix, reformatter) | Note as auto-fixed, list modified files, do not treat as blocking error |
| **misconfigured** | Hook config broken, unknown CLI flag | Flag as config issue pointing to the config file, not source code |

Environment and missing-tool failures pollute the artifact with content the agent cannot fix.
Detect them (connection errors, auth errors, "command not found", timeouts) and emit a
one-line skip note to the terminal instead.

## 4. Auto-fix before reporting

For any tool that supports auto-fix, run the fix pass first, then report only remaining
unfixable errors. This prevents the agent from wasting cycles on problems the tool already
solved.

- `ruff check --fix --unsafe-fixes` then `ruff format` before the reporting pass
- `eslint --fix`, `stylelint --fix`, `markdownlint --fix` before capturing output
- `pip-audit --fix` before the audit report
- Pre-commit hooks that auto-reformat: detect "files were modified by this hook", classify
  as `auto-fixed`, list the modified files

## 5. Section structure in artifacts

Each tool's failure block must follow this structure:

```text
# tool-name
# fix: one-liner command the agent can run to attempt a fix
<error lines -- one per issue, self-contained with file:line:col>
```

The `# fix:` hint gives the agent a starting point. Use the actual CLI command
(e.g. `ruff check . --fix --unsafe-fixes`), not a vague description.

## 6. Performance: parallel by default

- Launch independent linters / checks as parallel background jobs (`Start-Job`), not
  sequentially. The lint suite runs 13+ tools; sequential execution is unacceptable.
- Tools that mutate the same files (e.g. `ruff check --fix` then `ruff format`) must
  run sequentially within their job to avoid race conditions, but the combined job
  runs in parallel with all other tools.
- Use timeouts on external calls (Docker commands, DB connections) to prevent a hung
  daemon from blocking the entire script.

## 7. Cap output per failure

For test failures: cap each failure block (e.g. 25 lines) to prevent a single broken
test from flooding the artifact. Include a `... (N lines total, truncated)` note when
capping. If filtering strips all useful lines, fall back to raw output so the agent
always has something to work with.

## 8. Artifact lifecycle

- On **pass**: clear the artifact (write empty string) so stale errors do not mislead
  the agent in the next run.
- On **fail**: overwrite the artifact entirely -- never append to previous runs.
- Artifact paths are fixed contracts consumed by skills:
  - `logs/lint-errors.log` — written by `scripts/lint-all.ps1` (local) or `scripts/ci-digest.py` (CI)
  - `logs/test-failures.log` — written by `scripts/run-tests.ps1` (local) or `scripts/ci-digest.py` (CI)
  - `logs/pre-commit-errors.log` (pre-commit.ps1)
  - `logs/docker/health.log`, `logs/docker/config.log`, `logs/docker/app-logs.log` (docker-status.ps1)
- `scripts/ci-digest.py` is the CI equivalent of the two PS1 scripts above. It reads
  raw tool output from `reports/<tool>.txt` + `reports/<tool>.exit` (written by
  `.github/workflows/on-demand.yml`) and applies identical filtering, producing the
  same artifact format so `fix-lint` and `fix-tests` work unchanged in both environments.
