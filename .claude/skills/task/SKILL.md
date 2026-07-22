---
name: task
disable-model-invocation: true
description: 'Start a new task on a fresh claude/<slug> branch cut from latest origin/master. Use at the start of a new piece of work, especially in a worktree where you are never on master and always sit on a stale/merged branch.'
argument-hint: 'Short description of the task (used for the branch name)'
---

# Skill: Start a task on a fresh branch

The start-of-task partner to `/ship`. Cuts a fresh `claude/<slug>-<mmdd>` branch
from the latest `origin/master` so each task is isolated and current. Explicit
because the "I'm starting something new" boundary can't be inferred safely — the
local signals can't tell a freshly-cut empty branch from a stale merged one.

This is the entry point for the **worktree** workflow: you are never on `master`
(it's checked out in the primary worktree) and always sit on a stale, already-
shipped branch, so the auto branch-per-task hook never fires. Creating a *new*
branch off `origin/master` is allowed in a worktree even while `master` is
checked out elsewhere.

## Step 1 — Start the branch

```bash
python scripts/start-task.py "<the task description>"
```

Pass the argument through as the description; it becomes the branch slug. The
script fetches `origin`, verifies `origin/master`, and checks out a fresh branch
based on it.

Non-zero exits: `4` the tree is dirty (finish the current task with `/ship` or
stash first — it will not strand or carry your changes), `7` `origin/master`
missing after fetch, `8` checkout failed. Report and stop on any of these.

## Step 2 — Confirm and proceed

On success it prints the new branch name. Confirm you're on it
(`git branch --show-current`) and start the work. When the task is done, run
`/ship` to lint, commit, push, and open the PR.
