---
name: test-skill
disable-model-invocation: true
description: 'Validates Claude-style skill behavior by exercising frontmatter hooks and a suggested verification command. Use when checking Copilot/Claude agent compatibility end-to-end.'
argument-hint: '(no arguments)'
---

# Skill: Test Skill

This is a tiny compatibility smoke test for Claude-style skill features.

- Frontmatter `hooks` should write `logs/agent/test-skill-hook.txt` with a UTC ISO timestamp.
- The suggested verification command below is optional and helps confirm workspace diff state.

## Provenance guardrail (critical)

- The coding agent must **not** run equivalent script lines manually in a terminal.
- The coding agent must **not** directly create, edit, or overwrite any of these files:
  - `logs/agent/test-skill-hook.txt`
- This file is a test artifact and must be produced only by frontmatter `hooks`.

## Compatibility note (important)

- Invoke this as an actual skill command (for example `/test-skill`).
- If this file is only pasted/attached as plain prompt text, Claude/Copilot frontmatter hooks and suggested command text may be treated as plain text and not executed automatically.

Suggested verification command (optional, run manually):
```sh
gh pr diff
```

---

## Step 1 — Verify freshness and shape

Confirm the hook artifact file was updated for **this invocation**:

- `logs/agent/test-skill-hook.txt`

Requirements:

- The line must match its expected prefix + UTC ISO 8601 timestamp (`...Z`).
- Freshness gate: the extracted timestamp must be within the last **5 minutes**.

If any timestamp is stale or missing, treat the run as failed and reply with:

> FAIL: test-skill hook timestamp was not refreshed for this invocation; the frontmatter hook did not execute.

---

## Step 2 — Confirm

Reply with a single short message:

> Test file written with UTC timestamp: `logs/agent/test-skill-hook.txt`.
> Optionally run either of these commands to verify the change:
>
> ```sh
> gh copilot session status
> git diff --stat
> ```

Only use the success message above if Step 1 passed the freshness gate.
