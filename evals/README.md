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
npm run eval         # run the suite, write evals/output/latest.json
npm run eval:summary # print the with-vs-baseline delta from the last run (free)
npm run eval:view    # open the web UI to diff with-instructions vs baseline
npm run eval:coverage          # which instruction files have a test yet (free, no agent runs)
npm run eval:ablate -- <path>  # leave-one-out: what is ONE file worth? (slow, costs $)
npm run eval:rewrite -- <target> <variant>      # A/B the live file against a rewrite
npm run eval:section -- <file> "<heading>"      # what is ONE section of a SKILL.md worth?
```

Every comparison reports the three optimization axes side by side — **accuracy**
(`verifyPassed` / score, the pass gate), **tokens**, **latency**, and **cost** — so you
can pick the variant that stays correct while minimizing the rest.

The **Eval: Instruction Files (promptfoo)** VS Code task runs `eval` then prints the
summary automatically.

`eval:view` only displays results that already exist — run `eval` first, or the
viewer shows promptfoo's empty-state setup wizard (ignore it; everything is already
configured in `promptfooconfig.yaml`).

## Artifact for agents

Every run writes a structured JSON artifact to `evals/output/latest.json` (gitignored).
A coding agent can read it to act on results without re-running anything. Each test row
carries `vars`, `success`/`score`, the asserts, token usage, cost, and the behavioral
metrics under the provider response `metadata` (`toolCalls`, `failedToolCalls`,
`readsBeforeFirstEdit`, `verifyPassed`, …). Point an agent at that path to triage
regressions or propose instruction-file edits.

The **`/fix-instructions`** skill automates that: it reads `latest.json`, computes
the with-vs-baseline delta per task, and edits the underperforming instruction
markdown (strengthen / prune / trim) — the markdown counterpart to the `fix-*` code
fixers.

## Layout

```text
evals/
  promptfooconfig.yaml              two providers (with / without instructions) + task glob
  providers/
    claude-skill-provider.cjs       runs claude headless in a worktree, parses metrics
  tasks/
    <task-name>/test.yaml           one scenario: prompt + asserts + metadata.targets
  lib/compare.cjs                   shared with-vs-other delta printer (accuracy/tokens/latency/cost)
  lib/runner.cjs                    shared task discovery + two-provider run for the drivers
  lib/fixture.cjs                   helpers for fixer-task setup.cjs / verify.cjs
  summarize.cjs                     prints the latest.json delta (npm run eval:summary)
  ablate.cjs                        coverage view + leave-one-out driver (eval:coverage / eval:ablate)
  rewrite.cjs                       candidate-rewrite A/B driver (eval:rewrite)
  section-ablate.cjs                intra-file section ablation driver (eval:section)
  rewrites/<name>/                  candidate skill rewrites for A/B testing
  fixtures/<name>/                  committed broken fixtures for fixer-skill tasks
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

### Fixer-skill coverage

Every fixer skill that diagnoses from a **seedable log artifact** has an end-to-end
task built from the `fix-tests-logic-bug` template: `fix-tests`, `fix-lint`,
`fix-logs`, `fix-pester`, `fix-e2e`, `fix-pre-commit`, `fix-docker`. Each seeds the
skill's log (`setup.cjs`), points it at a committed broken fixture under
`evals/fixtures/`, and checks the repair (`verify.cjs`) — by content, or for
`fix-logs` by running the repaired code. The shared helpers live in
`evals/lib/fixture.cjs`.

**Not headless-testable (intentional gaps):**

| Skill | Why it can't be evaluated here |
|---|---|
| `fix-problems` | Reads **live** VS Code diagnostics via `get_errors` — there's no log artifact to seed in a throwaway worktree. |
| `fix-tests-auto` | An autonomous loop that **runs** pytest against a live Docker stack each iteration — not deterministic headless. Its underlying fix logic is covered by `fix-tests`. |
| `fix-all` | Aggregate dispatcher — no behavior of its own to measure. |
| `fix-instructions` | The markdown optimizer that acts on *these* results; testing it is meta and not yet wired. |

When adding a fixer skill, add its task too (see `.claude/rules/authoring.md`). If it's
genuinely untestable headless, add a row here with the reason instead of a flaky test.

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

### Fair baselines for /skill tasks (`baselinePrompt`)

A task whose `prompt` is a `/skill` would, in any arm that lacks the skill (the
strip-all baseline, or ablating the skill itself), just error with "Unknown skill" —
measuring nothing. Give such a task a `baselinePrompt` var: the skill's plain-English
equivalent. The arm without the skill runs that instead, so the comparison is "skill
scaffolding vs an unguided agent on the same problem". The with-instructions arm always
runs the real `/skill`.

### Weighting correctness over efficiency

Asserts take a `weight`, and a test takes a `threshold` (pass if weighted score ≥ it).
Weight the correctness assert (`verifyPassed`, the right answer) heavier than the
efficiency ones (`toolCalls`, `readsBeforeFirstEdit`) so a correct-but-slightly-slow run
passes, while the efficiency gap still shows up in the delta. See either `test.yaml`.

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

## Testing one file at a time (leave-one-out ablation)

The strip-everything baseline answers "do the instruction files collectively help?"
It can't tell you *which* file did the work, or which is dead weight. For that, ablate
one file at a time.

Each task declares the instruction files it exercises in `metadata.targets`:

```yaml
- metadata:
    targets:
      - .claude/rules/voip-providers.md
  vars:
    prompt: ...
```

Then:

```sh
npm run eval:coverage          # list every CLAUDE.md / rule / skill and which task tests it
npm run eval:ablate -- .claude/rules/voip-providers.md
```

`eval:ablate` builds a throwaway config (with-instructions vs `ablate-<file>`),
scoped to only the tasks that target the file, runs it, and prints the delta. If the
with-instructions column doesn't beat the ablated one on those tasks, the file isn't
earning its tokens — a pruning candidate. `npm run eval:ablate -- --all` sweeps every
targeted file (slow, costs credits).

The provider's `stripPaths` knob does the surgical removal; a commented worked-example
provider in `promptfooconfig.yaml` shows the inline form. Ablating a **skill** dir makes
that skill's task fall back to its `baselinePrompt`, so the comparison stays "skill vs
unguided agent" rather than "skill vs unresolved /command".

### Making every file testable

`eval:coverage` lists instruction files with **no** task (gaps). To close a gap, add a
task under `evals/tasks/<name>/test.yaml` whose `metadata.targets` names the file and
whose prompt + asserts only pass when that file's guidance is in effect. Keep the suite
lean — a focused task per high-value file beats broad coverage you can't afford to run.

## Choosing a comparison mode

The four modes answer different questions. Use the cheapest one that answers yours.

| Mode | Command | Question | Best for |
|---|---|---|---|
| Strip-all baseline | `npm run eval` | Do the instruction files help *at all*? | regression floor |
| File ablation | `eval:ablate -- <file>` | Is this *one file* net-positive? | finding dead-weight files |
| Section ablation | `eval:section -- <file> "<heading>"` | Is this one *section* worth its tokens? | trimming a bloated SKILL.md |
| Candidate rewrite | `eval:rewrite -- <target> <variant>` | Is rewrite **X** better than the current file? | testing a specific improvement |

Minimal-prompt / whole-file comparisons are **validation floors** — they confirm a
mature skill still helps but hit diminishing returns; they can't tell you *what to cut*
or *what to change*. For optimization, reach for section ablation (subtractive: find
dead weight) and candidate rewrites (directed: test a better version).

### Candidate rewrites (`eval:rewrite`)

Keep the alternative under `evals/rewrites/<name>/` (so skill dirs stay clean) and
commit it, then:

```sh
npm run eval:rewrite -- .claude/skills/fix-lint/SKILL.md evals/rewrites/fix-lint-concise/SKILL.md
```

The `replacePaths` knob swaps the live file's content for the variant in the worktree;
both arms run the real `/skill`. The worked example above is a ~40-line rewrite of the
~150-line fix-lint skill — run it to see whether the leaner version stays as accurate
while spending fewer tokens. If a rewrite wins, promote it over the original.

### Section ablation (`eval:section`)

```sh
npm run eval:section -- .claude/skills/fix-lint/SKILL.md "Known-fix matching"
```

`stripSections` removes the matched heading through the next same-or-higher heading.

**A section only shows its value on a task that stresses it.** Ablating the
"Known-fix matching" instruction does nothing on a task whose error matches no known
fix — you'd see no delta and wrongly call it dead weight. The `fix-lint-known-fix-s101`
task seeds an error that *is* in `known-fixes.md` precisely so that section has
something to bite on. When you add a heavy section worth testing, add a task that
triggers it.
