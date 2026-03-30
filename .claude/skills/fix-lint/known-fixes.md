# Known Lint Fixes

Quick-lookup table for recurring lint errors. When an error matches a pattern below,
apply the documented fix directly instead of reasoning from scratch.

<!-- Keep patterns as plain substrings — no regex needed. -->
<!-- One row per distinct failure pattern. Prune entries that stop recurring. -->
<!-- Hits/Last used are updated by the fix-lint skill each time a pattern matches. -->
<!-- Entries with 0 hits after 90+ days from Added date can be pruned. -->

| Error pattern (substring) | Root cause | Fix | Hits | Last used | Added |
|---|---|---|---|---|---|
| S603 | `subprocess.run` with list args triggers untrusted-input warning | Add `# noqa: S603, S607` to the `subprocess.run(` line | 1 | 2026-03-30 | 2026-03-30 |
| S607 | `subprocess.run` with partial executable name (e.g. `"git"`) triggers partial-path warning | Add `# noqa: S607` to the line containing the args list (ruff reports at the args line, not the `subprocess.run(` line) | 3 | 2026-03-30 | 2026-03-30 |
| CVE-2026-34073 | `cryptography` package has known vulnerability; minimum safe version is 46.0.6 | Bump floor in `requirements.txt` to `>=46.0.6` | 2 | 2026-03-30 | 2026-03-30 |
| `# fix: ruff check . --fix --unsafe-fixes` | Lint log contains auto-fixable ruff errors (task annotates them with this comment) | Instruct user to run `ruff check . --fix --unsafe-fixes` — do not apply these manually | 0 | — | 2026-03-30 |
| `# fix: pip install --upgrade` | pip-audit found a vulnerable package needing a version bump | Bump the affected package floor in `requirements.txt` to the patched version shown in the log | 0 | — | 2026-03-30 |
