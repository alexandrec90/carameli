# Instruction-file evals

A [promptfoo](https://www.promptfoo.dev/) harness that measures whether this repo's
instruction files (`CLAUDE.md` + `.claude/rules` + `.claude/skills`) actually improve
agent behavior — and which ones are dead weight.

It runs each task through a **real Claude Code agent** in a throwaway git worktree,
twice: once with the instruction files present, once with them stripped out. Then it
compares correctness, tool-call count, failed calls, tokens, and cost.

## Cost & prerequisites

- No promptfoo subscription needed — it's MIT-licensed and runs fully locally.
- No separate API key — the agent runs via your existing Claude Code CLI auth, so
  runs draw on your normal Claude credits.
- Each task spawns a full agent run, so the suite is **slow and not free**. Keep it
  small and targeted.
- Requires the `claude` CLI on PATH and a clean-ish git tree (worktrees check out
  committed `HEAD` — commit instruction edits before evaluating).

## Run

```sh
npm run eval        # run the suite, print the comparison table
npm run eval:view   # open the web UI to diff with-instructions vs baseline
```

## Layout

```text
evals/
  promptfooconfig.yaml              two providers (with / without instructions) + task glob
  providers/
    claude-skill-provider.cjs       runs claude headless in a worktree, parses metrics
  tasks/
    <task-name>/test.yaml           one scenario: prompt + asserts
```

## Metrics each run reports

Returned on the provider response; assert on them via
`context.providerResponse.metadata` in a `javascript` assertion:

| Metric | Meaning |
|---|---|
| `toolCalls` | total tool invocations |
| `failedToolCalls` | tool results flagged `is_error` |
| `readsBeforeFirstEdit` | investigation-spiral signal (high = thrashing before acting) |
| `madeAnEdit` | whether the agent edited any file |
| `numTurns` | agent turns to completion |

`tokenUsage` and `cost` are first-class and auto-aggregate in the results table.

## Task types

- **`provider-import-boundary`** — read-only. Safe to run repeatedly; proves the
  pipeline and demonstrates the with/without-instructions comparison.
- **`fix-tests-logic-bug`** — the destructive-task template. Evaluates the
  `/fix-tests` skill against a deliberately broken fixture, end to end.

### Per-task hooks (`setup` / `verify`)

A task can name two optional `.cjs` hooks via vars; the provider runs them in the
worktree around the agent:

| Var | When | Signature | Purpose |
|---|---|---|---|
| `setup` | before the agent | `(worktree) => void` | seed broken state (e.g. write a failure log) |
| `verify` | after the agent, before teardown | `(worktree) => boolean` | check the repair; result lands in `metadata.verifyPassed` |

`verify` must run before teardown because the worktree is deleted once the run
returns — promptfoo assertions can't reach it afterward, so correctness is captured
as a metric and asserted via `context.providerResponse.metadata.verifyPassed`.

### How the fix-tests template stays leak-safe

- The broken fixture lives under `evals/fixtures/` — `pytest` only collects `tests/`
  (see `pytest.ini`), and `ruff`/`mypy` exclude `evals/fixtures/`, so it never affects
  normal runs.
- The bug is a **logic error** (valid, well-typed Python), so even if a linter did
  see it, there'd be nothing to flag.
- `/fix-tests` is log-driven, so `setup.cjs` seeds `logs/test-failures.log`; the agent
  repairs the fixture **in the worktree only**. The real fixture stays broken on
  purpose — that's the test data.

To add another fixer task, copy the `fix-tests-logic-bug/` folder, swap the fixture +
seeded log, and point `verify.cjs` at the new correctness check. Watch
`readsBeforeFirstEdit` and `failedToolCalls` across the two providers — that's where
the known-fixes short-circuit should earn its keep.

## Pruning a rule file

To test whether a specific rule earns its tokens, run the suite, then temporarily
remove that rule file, commit, and run again. If the with-instructions column doesn't
move on the tasks that rule is supposed to help, it's a pruning candidate.
