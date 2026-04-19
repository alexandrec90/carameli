---
name: test-skill
description: 'Smoke-tests the gh copilot task pipeline by writing a timestamped sentinel file. Use when verifying that skill invocation, worktree isolation, and session status reporting all work end-to-end.'
argument-hint: '(no arguments)'
---

# Skill: Test Skill

Makes a small, observable change to the repository so that
`gh copilot session status` shows a real git diff.

---

## Step 1 — Write the sentinel file

Create or overwrite `logs/agent/test-skill-sentinel.txt` with these exact contents
(replace `<ISO_TIMESTAMP>` with the current UTC date-time in ISO 8601 format):

```
test-skill ran at <ISO_TIMESTAMP>
```

Use `create_file` if the file does not exist, or `replace_string_in_file` (replace the
entire content) if it does.

---

## Step 2 — Confirm

Reply with a single short message:

> Sentinel written to `logs/agent/test-skill-sentinel.txt`.
> Run `gh copilot session status` (or `git diff --stat`) to observe the change.
