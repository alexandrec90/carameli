# Known Pre-Commit Fixes

Quick-lookup table for recurring pre-commit hook failures (diagnosed from
`logs/pre-commit-errors.log`). When a failure matches a pattern below, apply the
documented fix directly instead of reasoning from scratch.

<!-- Keep patterns as plain substrings — no regex needed. -->
<!-- One row per distinct failure pattern. Prune entries that stop recurring. -->
<!-- Hits/Last used are updated by the fix-pre-commit skill each time a pattern matches. -->
<!-- Entries with 0 hits after 90+ days from Added date can be pruned. -->

| Error pattern (substring) | Root cause | Fix | Hits | Last used | Added |
|---|---|---|---|---|---|
