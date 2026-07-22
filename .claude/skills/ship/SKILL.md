---
name: ship
disable-model-invocation: true
description: 'Ship the current task: lint pre-flight, commit, push, open a PR to master, and start the autofix loop. Use when a task is complete and the user asks to ship / open a PR for the current change.'
argument-hint: 'Optional PR title'
---

# Skill: Ship the current task

Takes the finished work on the current feature branch all the way to an open PR
against `master`, then hands the PR to the CI-autofix loop. Explicit-invocation
only (`/ship`) — it pushes and opens a PR, so it must never fire mid-task. The
branch itself is created by the branch-per-task `UserPromptSubmit` hook
(`scripts/hooks/branch-per-task.py`) when you start work on `master`.

Run the steps in order. Stop and report if a step fails — do not open a PR from
a branch that failed pre-flight.

## Step 1 — Preflight (fail fast)

```bash
python scripts/ship.py --preflight
```

Exit `3` means you are on `master` or detached HEAD — there is nothing to ship
from. Report that and stop; the work needs to be on a `claude/...` branch first.

## Step 2 — Test + lint locally

The Stop hook already reproduces the PR-gate checks on the diff, but confirm the
change is green before pushing so CI is a formality, not the first check:

```bash
python scripts/lint-all.py --changed
```

Fix anything in `logs/lint-errors.log`. If you touched code, make sure its tests
exist and pass (project rule: tests ship in the same commit) — run the targeted
suite for what you changed.

## Step 3 — Commit

Stage the change and write a clear, descriptive commit message (imperative
subject, a body explaining the why). Include the project's commit footers.

```bash
git add -A
git commit -F - <<'EOF'
<subject>

<body>
EOF
```

## Step 4 — Push (lint gate + retry)

```bash
python scripts/ship.py
```

This re-asserts the branch, requires a clean tree (so commit first), runs the
changed-scope lint gate, and pushes with network-error backoff. Non-zero exit
codes: `4` dirty tree, `5` lint failed (see `logs/lint-errors.log`), `6` push
failed. Resolve and re-run.

## Step 5 — Open the PR

Check for a PR template first (`.github/pull_request_template.md` and the other
standard locations). Create the PR against `master` with the GitHub MCP tool,
filling the template if one exists:

- `mcp__github__create_pull_request` — base `master`, head = current branch,
  title from the argument or the commit subject, body summarizing the change.

Do **not** create the PR if any earlier step failed.

## Step 6 — Start the autofix loop

Ask the user whether to watch the PR (unless they already said to). If yes:

- `subscribe_pr_activity` for the new PR — CI failures and review comments then
  wake this session and you autofix per the PR-activity workflow.

This repo has no branch protection; `dependabot-automerge.yml` merges once the
PR Gate passes. If the user wants hands-off merge, enable it with
`mcp__github__enable_pr_auto_merge`.

## Report

Reply with the PR URL, its number, and whether the autofix subscription is
active. That PR URL is the deliverable.
