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

At the end of each significant work session, archive a git-based summary by
running this command in the terminal:

```bash
pwsh -ExecutionPolicy Bypass -Command "python scripts/hooks/archive-session-copilot.py 'brief description'"
```

Or use the **"Agent: Archive Copilot Session"** VS Code task.
This writes a JSON summary to `logs/agent/` for post-mortem analysis.
