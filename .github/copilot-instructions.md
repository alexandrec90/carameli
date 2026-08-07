# Carameli — GitHub Copilot Agent Instructions

## Watchdog: Investigation Spiral Prevention

Count your consecutive **read-only** tool calls since the last **write**.

Read-only tools: `read_file`, `grep_search`, `file_search`, `semantic_search`,
`fetch_webpage`, `get_errors`, `tool_search_tool_regex`, `list_dir`, `view_image`

Write tools: `replace_string_in_file`, `multi_replace_string_in_file`,
`create_file`, `run_in_terminal`, `memory` (create/str_replace/insert/delete)

Rules:

- **At 15 consecutive reads with no write**: stop reading immediately.
  Attempt a fix based on what you already know, or ask the user if stuck.
  Do NOT read more files.
- **Every 5 reads after that (20, 25, ...)**: repeat the self-correction.

## Session Archive

Removed 2026-08-07. This section used to tell you to run
`scripts/hooks/archive-session-copilot.py`, but that script and its sibling
`archive-session.py` had already been deleted, so the command failed and the
`logs/agent/` directory it wrote to went stale — 127 dumps, nothing reading them.

There is no session-archive step. Do not recreate one here without a writer to go
with it.
