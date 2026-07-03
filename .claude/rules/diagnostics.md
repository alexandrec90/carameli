---
description: Design rules for diagnostic scripts that produce log artifacts for AI-agent consumption
paths:
  - scripts/**/*.py
---

# Rule: Diagnostic Script Design

Diagnostic scripts in `scripts/` produce log artifacts in `logs/` that are consumed by
coding-agent skills (`fix-lint`, `fix-tests`, `fix-pre-commit`, `fix-docker`). Every design
decision in these scripts must prioritize: **Can an AI agent read this log and fix the problem
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
- **No cry-wolf reporting** -- before reporting that the script changed something (auto-fix,
  baseline update, file rewrite), **verify the change actually happened**: compare the file's
  content before/after, and check the mutating command's exit code -- never assume it worked.
  A status line that re-reports the same "N new findings" every run because its fix step
  silently fails is a runner bug (this happened: `detect-secrets scan --update` does not exist
  in detect-secrets 1.5, so the "376 new findings" auto-fix message repeated forever). It
  trains humans and agents to dismiss the runner's output and sends the next agent in circles.
  This applies to the runner's own terminal status lines, not just the artifact -- every
  message a run emits must be actionable, or true and new.

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
- Exception — `pip-audit` is **report-only**: the auto-fix rule applies to files in the
  repo, not to the environment. Auto-upgrading packages mutates the venv and silently
  drifts it from `requirements*.txt` and CI. Vulnerable packages are fixed by a reviewed
  dependency bump (Dependabot PR), never as a lint side effect.
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

- Launch independent linters / checks as parallel background jobs (threads or
  subprocesses), not sequentially. The lint suite runs 13+ tools; sequential execution
  is unacceptable.
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
  - `logs/lint-errors.log` — consumed by `fix-lint`
  - `logs/test-failures.log` — consumed by `fix-tests` (backend pytest-format targets)
  - `logs/frontend-test-failures.log` — vitest failures, **CI only** (`run-tests.py` splits
    them out via `diagnostics.digest_tests(..., include=FRONTEND_TEST_TARGETS)`). Fixed
    locally like every other artifact; a local run folds all sections into
    `logs/test-failures.log`.
  - `logs/pre-commit-errors.log` — consumed by `fix-pre-commit`
  - `logs/docker/health.log`, `logs/docker/config.log`, `logs/docker/app-logs.log` — consumed by `fix-docker`
- Each artifact carries a `# source:` header naming the runner that produced it
  (e.g. `scripts/lint-all.py`, `scripts/run-tests.py`), so a consuming skill can locate the
  producer — it is never hard-coded into a skill.
- The lint and test runners (`scripts/lint-all.py`, `scripts/run-tests.py`) produce these
  artifacts in **every** environment: the VS Code tasks and `.github/workflows/on-demand.yml`
  both invoke the same Python entrypoints (CI sets `CI=true` to pick the CI execution path).
  All filtering lives in one shared module, `scripts/diagnostics.py` — there is no separate
  local/CI filter to keep in sync. Change the filter once in `diagnostics.py` and both follow.
- `scripts/diagnostics.py` is pure (no subprocess, no file writes) and unit-tested in
  `scripts/hooks/tests/test_diagnostics.py`; the runners hand it in-memory tool output and
  write whatever it returns.
