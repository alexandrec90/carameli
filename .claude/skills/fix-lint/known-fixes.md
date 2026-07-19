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
| `# fix: pip install --upgrade` | pip-audit found a vulnerable package needing a version bump | Bump the affected package floor in `requirements.txt` to the patched version shown in the log | 2 | 2026-06-18 | 2026-03-30 |
| `no-any-return` in jambonz.py | `resp.json()` returns `Any`, so `.get()` on it also returns `Any`, violating the declared return type | Add `from typing import Any, cast` and wrap the return expression in `cast(list[dict[Any, Any]], ...)` | 1 | 2026-04-02 | 2026-04-02 |
| `Detected removed index` + `Detected removed foreign key` on agent_statuses | Model FK missing `ondelete="SET NULL"` and `index=True`, causing drift vs migration 005 | Add `ondelete="SET NULL"` to both `ForeignKey(...)` calls and `index=True` to `customer_id` in `app/models/agent_status.py` | 1 | 2026-04-02 | 2026-04-02 |
| `# fix: alembic revision --autogenerate -m 'describe change'` | alembic check failed — either unapplied migrations or model drift | First run `alembic current` vs `alembic heads`: if DB is behind, run `alembic upgrade head`; if up-to-date but check still fails, run `alembic revision --autogenerate -m 'describe change'` and review | 3 | 2026-06-26 | 2026-04-06 |
| `declaration-block-single-line-max-declarations` | CSS rule block contains multiple declarations on one line (e.g. `.foo { a: 1; b: 2; }`) | Expand each property onto its own line | 1 | 2026-04-08 | 2026-04-08 |
| `jsx-a11y/click-events-have-key-events` | Interactive `onClick` on a non-input element has no keyboard event listener | Add `onKeyDown={(e) => { if (e.key === 'Enter' \|\| e.key === ' ') handler() }}` alongside `onClick` | 1 | 2026-04-08 | 2026-04-08 |
| `jsx-a11y/no-static-element-interactions` | Non-interactive element (`span`, `div`) has an event handler without a role | Add `role="button"` and `tabIndex={0}` to the element | 1 | 2026-04-08 | 2026-04-08 |
| `react-hooks/exhaustive-deps` | Variable used inside `useEffect` body is missing from the dependency array | Add the missing variable(s) to the `useEffect` dependency array | 1 | 2026-04-08 | 2026-04-08 |
| B017 | `pytest.raises(Exception)` uses a blind exception assertion | Replace with the concrete exception type expected from the call (e.g., `httpx.HTTPStatusError`) | 1 | 2026-04-20 | 2026-04-20 |
| S311 | Non-cryptographic randomness in load tests triggers Ruff security warning | For load/perf-only random selection, add `# noqa: S311` on the specific `random.choice(...)` line | 1 | 2026-04-20 | 2026-04-20 |
| RUF012 | Mutable class attribute default (e.g., list on class) | Annotate as `ClassVar[...]` to mark intentional class-level state | 1 | 2026-04-20 | 2026-04-20 |
| ASYNC221 | Async test calls blocking `subprocess.run` intentionally | Add targeted `# noqa: ASYNC221` on the intentional `subprocess.run(...)` line in slow migration tests | 1 | 2026-04-20 | 2026-04-20 |
| E402 | Imports placed below executable/module code | Move module-level imports to the top import block; keep test helpers below imports | 1 | 2026-04-20 | 2026-04-20 |
| MD040/fenced-code-language | Markdown fence opened with plain ``` and no language | Add a language tag (use `text` for directory trees/plain text snippets) | 2 | 2026-07-01 | 2026-04-20 |
| MD024/no-duplicate-heading | Duplicate heading text in the same markdown file | Rename repeated headings with section-specific suffixes (e.g., `(B1)`, `(B2)`) | 2 | 2026-06-18 | 2026-04-20 |
| Secret Keyword [not in baseline] | Example literals include `secret`-like values in tests/docs and trigger detect-secrets | Add `// pragma: allowlist secret` inline comment on the flagged line; for non-code files (workflows, state JSON) run `detect-secrets scan --update .secrets.baseline` | 3 | 2026-06-18 | 2026-04-20 |
| S101 | `assert` in a pytest test file (or template) triggers ruff S101 | Add `# ruff: noqa: S101` at the top of the file — safe for test-only files | 1 | 2026-06-18 | 2026-06-18 |
| N803 | camelCase argument name in a Python function (e.g., route path param `customerId`) | Add `# noqa: N803` to the specific parameter line; only suppress where camelCase is required by the wire contract | 1 | 2026-06-18 | 2026-06-18 |
| MD001/heading-increment | Markdown heading jumps more than one level (e.g., h1 → h3 skipping h2) | Change the heading to the correct level (e.g., `###` → `##`) or insert an intermediate heading | 1 | 2026-06-18 | 2026-06-18 |
| MD052/reference-links-images | Array-style form field names like `[0][Date]` parsed by markdown as reference links with undefined label | Wrap the field name in backticks (e.g., `` `Start[0][Date]` ``) to treat it as inline code | 1 | 2026-06-26 | 2026-06-26 |
| SpaceCharacter / ValueWithoutQuotes / UnorderedKey (dotenv-linter) | Inline ` #comment` after a (often empty) value in `.env` reads as spaces/unquoted value; keys out of alphabetical order within a block | Move each inline comment to its own line above the key (dotenv parses ` #...` as comment, so semantics are unchanged), alphabetize keys within the blank-line-separated block, ensure trailing newline. Recheck with `dotenv-linter check .env` (the `check` subcommand is required). | 1 | 2026-07-19 | 2026-07-19 |
