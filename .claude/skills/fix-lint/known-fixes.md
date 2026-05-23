# Known Lint Fixes

Quick-lookup table for recurring lint errors. When an error matches a pattern below,
apply the documented fix directly instead of reasoning from scratch.

<!-- Keep patterns as plain substrings — no regex needed. -->
<!-- One row per distinct failure pattern. Prune entries that stop recurring. -->
<!-- Hits/Last used are updated by the fix-lint skill each time a pattern matches. -->
<!-- Entries with 0 hits after 90+ days from Added date can be pruned. -->

| Error pattern (substring) | Root cause | Fix | Hits | Last used | Added |
|---|---|---|---|---|---|
| S603 | `subprocess.run` with list args triggers untrusted-input warning | Add `# noqa: S603, S607` to the `subprocess.run(` line | 2 | 2026-04-20 | 2026-03-30 |
| S607 | `subprocess.run` with partial executable name (e.g. `"git"`) triggers partial-path warning | Add `# noqa: S607` to the line containing the args list (ruff reports at the args line, not the `subprocess.run(` line) | 4 | 2026-04-20 | 2026-03-30 |
| CVE-2026-34073 | `cryptography` package has known vulnerability; minimum safe version is 46.0.6 | Bump floor in `requirements.txt` to `>=46.0.6` | 2 | 2026-03-30 | 2026-03-30 |
| `# fix: pip install --upgrade` | pip-audit found a vulnerable package needing a version bump | Bump the affected package floor in `requirements.txt` to the patched version shown in the log | 1 | 2026-04-16 | 2026-03-30 |
| `no-any-return` in jambonz.py | `resp.json()` returns `Any`, so `.get()` on it also returns `Any`, violating the declared return type | Add `from typing import Any, cast` and wrap the return expression in `cast(list[dict[Any, Any]], ...)` | 1 | 2026-04-02 | 2026-04-02 |
| `Detected removed index` + `Detected removed foreign key` on agent_statuses | Model FK missing `ondelete="SET NULL"` and `index=True`, causing drift vs migration 005 | Add `ondelete="SET NULL"` to both `ForeignKey(...)` calls and `index=True` to `customer_id` in `app/models/agent_status.py` | 1 | 2026-04-02 | 2026-04-02 |
| `# fix: alembic revision --autogenerate -m 'describe change'` | SQLAlchemy model changed without a matching Alembic migration; alembic check detected schema drift | Run `alembic revision --autogenerate -m 'describe change'` then review the generated file; check `app/models/` for recent column/table additions that lack a migration | 2 | 2026-04-20 | 2026-04-06 |
| `declaration-block-single-line-max-declarations` | CSS rule block contains multiple declarations on one line (e.g. `.foo { a: 1; b: 2; }`) | Expand each property onto its own line | 1 | 2026-04-08 | 2026-04-08 |
| `jsx-a11y/click-events-have-key-events` | Interactive `onClick` on a non-input element has no keyboard event listener | Add `onKeyDown={(e) => { if (e.key === 'Enter' \ | \ | e.key === ' ') handler() }}` alongside `onClick` | 1 | 1 | 1 | 1 | 1 | 1 | 2026-04-08 | 2026-04-08 |
| `jsx-a11y/no-static-element-interactions` | Non-interactive element (`span`, `div`) has an event handler without a role | Add `role="button"` and `tabIndex={0}` to the element | 1 | 2026-04-08 | 2026-04-08 |
| `react-hooks/exhaustive-deps` | Variable used inside `useEffect` body is missing from the dependency array | Add the missing variable(s) to the `useEffect` dependency array | 1 | 2026-04-08 | 2026-04-08 |
| `PSUseApprovedVerbs` | PowerShell function uses an unapproved verb (e.g. `Ensure-`, `Verify-`) | Rename to use an approved PowerShell verb (`Initialize-`, `Test-`, `Set-`, etc.) and update all call sites | 1 | 2026-04-08 | 2026-04-08 |
| `PSUseSingularNouns` | PowerShell function name uses a plural noun | Rename to use a singular noun and update all call sites | 1 | 2026-04-08 | 2026-04-08 |
| `PSAvoidUsingEmptyCatchBlock` | Empty PowerShell `catch {}` block triggers PSScriptAnalyzer warning | Add `Write-Verbose "<context>: $_"` inside the catch block (or `Write-Error` / `throw` if the error is not expected) | 1 | 2026-04-16 | 2026-04-16 |
| B017 | `pytest.raises(Exception)` uses a blind exception assertion | Replace with the concrete exception type expected from the call (e.g., `httpx.HTTPStatusError`) | 1 | 2026-04-20 | 2026-04-20 |
| S311 | Non-cryptographic randomness in load tests triggers Ruff security warning | For load/perf-only random selection, add `# noqa: S311` on the specific `random.choice(...)` line | 1 | 2026-04-20 | 2026-04-20 |
| RUF012 | Mutable class attribute default (e.g., list on class) | Annotate as `ClassVar[...]` to mark intentional class-level state | 1 | 2026-04-20 | 2026-04-20 |
| ASYNC221 | Async test calls blocking `subprocess.run` intentionally | Add targeted `# noqa: ASYNC221` on the intentional `subprocess.run(...)` line in slow migration tests | 1 | 2026-04-20 | 2026-04-20 |
| E402 | Imports placed below executable/module code | Move module-level imports to the top import block; keep test helpers below imports | 1 | 2026-04-20 | 2026-04-20 |
| MD040/fenced-code-language | Markdown fence opened with plain ``` and no language | Add a language tag (use `text` for directory trees/plain text snippets) | 1 | 2026-04-20 | 2026-04-20 |
| MD024/no-duplicate-heading | Duplicate heading text in the same markdown file | Rename repeated headings with section-specific suffixes (e.g., `(B1)`, `(B2)`) | 1 | 2026-04-20 | 2026-04-20 |
| Secret Keyword [not in baseline] | Example literals include `secret`-like values in tests/docs and trigger detect-secrets | Replace placeholder values with neutral key names; avoid `*-secret` literal strings in examples | 2 | 2026-04-20 | 2026-04-20 |
| PSAvoidAssignmentToAutomaticVariable | PowerShell parameter name collides with automatic variable (`$Host`) | Rename parameter (e.g., `$TargetHost`) and update downstream references | 1 | 2026-04-20 | 2026-04-20 |





