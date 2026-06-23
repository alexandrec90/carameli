# Known Docker Fixes

Quick-lookup table for recurring Docker stack failures (diagnosed from
`logs/docker/health.log`, `config.log`, and `app-logs.log`). When a failure matches a
pattern below, apply the documented fix directly instead of reasoning from scratch.

<!-- Keep patterns as plain substrings — no regex needed. -->
<!-- One row per distinct failure pattern. Prune entries that stop recurring. -->
<!-- Hits/Last used are updated by the fix-docker skill each time a pattern matches. -->
<!-- Entries with 0 hits after 90+ days from Added date can be pruned. -->

| Error pattern (substring) | Root cause | Fix | Hits | Last used | Added |
|---|---|---|---|---|---|
