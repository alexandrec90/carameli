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

### Spend guardrails

Because every task burns real credits, three layers cap how much a run can spend —
`eval:stable --repeat 3` once drained a whole budget, so cost is now treated as a
first-class pass/fail axis, not just a reported column:

0. **Default effort** — interactive-session knobs (`effortLevel`,
   `MAX_THINKING_TOKENS`, `CLAUDE_CODE_ALWAYS_ENABLE_EFFORT`, `CLAUDE_EFFORT`) force a
   64k-token thinking budget every turn (a major subscription-quota sink) and 400 on
   models without effort support (Haiku). The provider removes them from **both**
   vectors: the worktree's `.claude/settings.json` (so it isn't a hidden variable
   between arms) **and** the spawned agent's environment (so they can't be inherited
   from the launching shell — e.g. an interactive Claude Code session — and reach the
   agent regardless of the worktree). Every arm runs at the model's default effort.
1. **Per-agent turn cap** — `--max-turns 40` (in `promptfooconfig.yaml`) bounds a
   single agent's loop so a spiral can't burn the budget inside the wall-clock
   timeout. 40 clears the healthy ceiling (~30 turns on the hardest tasks).
2. **Per-task budget = FAIL** — the provider compares each run's cost to a per-tier
   ceiling (Haiku `$0.40`, Sonnet `$1.00`) and surfaces `metadata.overBudget`. A
   `defaultTest` assertion (weight 3, equal to the correctness assert) **fails any
   over-budget run even if its output was correct**. Override per task with
   `vars.costBudgetUsd`, or globally with `EVAL_TASK_MAX_USD`.
3. **Cumulative run cap** — once a run's total spend crosses `EVAL_MAX_USD`
   (default `$20`), the provider short-circuits remaining tasks *before* spawning
   another agent, so a runaway suite can't drain everything. Raise it to allow a
   bigger run: `EVAL_MAX_USD=40 npm run eval:stable`.

Cheapest way to keep spend down day-to-day: prefer `npm run eval:quick` (a small seeded
task sample) for a smoke/cost check, `npm run eval` (single pass, full suite) for the real
comparison, and scope to one file with `eval:ablate` when iterating. Reserve `eval:stable`
(3×) for decisions that need variance.

> **Why a sample and not a one-arm filter?** promptfoo validates each task's declared
> `providers:` against the active provider set, so `--filter-providers` throws once tasks
> name a provider you've filtered out. To run a cheap subset, filter *tasks*
> (`--filter-sample`, `--filter-first-n`, `--filter-range`) and let each run both arms.

**Provider scoping is per-task, not global.** Every task must declare which providers it
runs against, because promptfoo runs a test against ALL top-level providers unless the test
overrides it — a task with no `providers:` line silently runs on the Sonnet arms too,
doubling its cost. Cheap (Haiku) tasks declare `providers: [with-instructions,
baseline-no-instructions]`; multi-step tasks that need Sonnet declare
`providers: [with-instructions-capable, baseline-capable]`. The `--max-turns` cap is
tier-split to match (cheap 20, capable 40).

**Spend log.** The provider appends one JSON line per run to `logs/eval-spend.log`
(gitignored), flushed as each task completes — plus a line when the cumulative cap
short-circuits a run. Unlike `evals/output/latest.json` (written only when promptfoo
finishes), this survives a run that's killed mid-way, so you can always see where the
money went. Tail it in another terminal to watch spend live:

```sh
tail -f logs/eval-spend.log    # each line: {time, provider, model, costUsd, cumulativeUsd, overBudget, task}
```

## Run

```sh
npm run eval         # run the suite once, write evals/output/latest.json
npm run eval:quick   # a small seeded sample of tasks (both arms) — cheapest "does it run / what's the cost" smoke check
npm run eval:stable  # run with --repeat 3 — variance-checked numbers for decisions
npm run eval:summary # print the with-vs-baseline delta from the last run (free)
npm run eval:test    # unit-test the provider's spend guardrails (free, no agent runs)
npm run eval:view    # open the web UI to diff with-instructions vs baseline
npm run eval:coverage          # which instruction files have a test yet (free, no agent runs)
npm run eval:ablate -- <path>  # leave-one-out: what is ONE file worth? (slow, costs $)
npm run eval:rewrite -- <target> <variant>      # A/B the live file against a rewrite
npm run eval:section -- <file> "<heading>"      # what is ONE section of a SKILL.md worth?
```

Every comparison reports the three optimization axes side by side — **accuracy**
(`verifyPassed` / score, the pass gate), **tokens**, **latency**, and **cost** — so you
can pick the variant that stays correct while minimizing the rest.

### Variance: a single run is a point estimate

Agent runs are stochastic, so one `npm run eval` row can swing on noise. `eval:summary`
guards against acting on jitter:

- A **single** run prints each verdict tagged `provisional`.
- `eval:stable` runs each task `--repeat 3`; the summary then reports **median [min-max]**
  per metric and, when the two arms' tool-call ranges **overlap**, marks the task
  `INCONCLUSIVE` — the delta is within run-to-run noise at that sample size.
- `/fix-instructions` must not edit instructions off an `INCONCLUSIVE` or `provisional`
  row (its Hard Rule 9). Make decisions — especially deletions — off `eval:stable`.

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
| `costUsd` | this run's `total_cost_usd` |
| `costBudgetUsd` | the per-task ceiling applied to this run |
| `overBudget` | run cost exceeded its budget — asserted on in `defaultTest`, fails the task |
| `cumulativeCostUsd` | running total across the whole eval (drives the `EVAL_MAX_USD` cap) |

`tokenUsage` and `cost` are first-class and auto-aggregate in the results table.

## Task types

- **`provider-import-boundary`** — read-only. Safe to run repeatedly; proves the
  pipeline and demonstrates the with/without-instructions comparison.
- **`fix-tests-logic-bug`** — the destructive-task template. Evaluates the
  `/fix-tests` skill against a deliberately broken fixture, end to end (the
  diagnose-from-scratch path).
- **`fix-tests-known-fix`** — a failure whose pattern is in `fix-tests/known-fixes.md`,
  so it stresses the known-fix short-circuit. Pair with section-ablation of the
  "Known-fix matching" section.
- **`fix-tests-low-quality-log`** — a log whose traceback was filtered out, so it
  stresses the mandatory "Log quality gate": the agent must widen the producing filter
  (`scripts/diagnostics.py`) instead of guess-fixing source. Pair with section-ablation
  of that gate.

### Fixer-skill coverage

Every fixer skill that diagnoses from a **seedable log artifact** has an end-to-end
task built from the `fix-tests-logic-bug` template: `fix-tests`, `fix-lint`,
`fix-logs`, `fix-e2e`, `fix-pre-commit`, `fix-docker`. Each seeds the
skill's log (`setup.cjs`), points it at a committed broken fixture under
`evals/fixtures/`, and checks the repair (`verify.cjs`) — by content, or for
`fix-logs` by running the repaired code. The shared helpers live in
`evals/lib/fixture.cjs`.

**Not headless-testable (intentional gaps):**

| Skill | Why it can't be evaluated here |
|---|---|
| `fix-problems` | Reads **live** VS Code diagnostics via `get_errors` — there's no log artifact to seed in a throwaway worktree. |
| `fix-all` | Pure dispatcher — just runs `/fix-tests` then `/fix-lint` in order, with no behavior of its own to evaluate (the two sub-skills are tested individually). |
| `fix-prs` (lifecycle) | *(partially covered — see `evals/tasks/fix-prs-triage/`.)* Only the skill's **offline/degraded path** (Step 0: `gh` unreachable → fix the current checkout from a seeded artifact by delegating to `/fix-tests`) is headless-testable. The PR lifecycle — `gh pr checkout`, reproduce, push, poll the gate, `gh pr merge` — needs a real remote + open PR + network, none of which exist in a throwaway worktree, so it is excluded by nature. |
| `fix-workflows` (lifecycle) | Same shape as `fix-prs`, so its headless slice is **already covered by `fix-prs-triage`**: both skills' only offline-testable behavior is Step 0's degraded path (`gh` unreachable → fix the current checkout from a seeded artifact by delegating to a `fix-*` skill), which is identical here. Its unique behavior — `gh run list` across workflows → filter already-fixed/stale failures → new `fix/*` branch → PR → poll the gate → merge — needs a real remote + a failed run + network, none of which exist in a throwaway worktree. A second Sonnet-tier destructive task for the identical degraded slice would double recurring eval cost for no new signal, so it is documented here instead (per `.claude/rules/authoring.md`'s escape hatch). |
| `triage-fixers` | *(covered — see `evals/tasks/triage-fixers/`.)* |
| `retro` | Digests **live** session transcripts from `~/.claude/projects/<sanitized-cwd>/` — a throwaway eval worktree has no session history, and seeding a fabricated transcript would test the fixture, not the skill's judgment. Per `.claude/rules/authoring.md`, the safety net is unit tests on the underlying script: the parse/render/selection logic in `.claude/skills/retro/extract.py` is covered by `scripts/hooks/tests/test_retro_extract.py`. |
| `gen-fixer-eval` | **Generates eval tasks** from a real `error → fix commit → outcome` triple — its output *is* a new eval scaffold, and it needs the fix commit reachable in git history (not present in a throwaway worktree checked out from `HEAD`). Per `.claude/rules/authoring.md`, the safety net is unit tests on the underlying script, not a flaky agent eval: the pure scaffold/classification/diff logic in `scripts/gen-eval-fixture.py` is covered by `scripts/hooks/tests/test_gen_eval_fixture.py` (35+ cases — classification, multi-file/added/flake skips, diff parsing, discriminating-line selection, and a full `build_scaffold` whose generated `test.yaml` is asserted to load and carry `metadata.generated: true`). |

`fix-instructions` — the markdown optimizer that acts on *these* results — **is** wired,
via the `fix-instructions-self` task: `setup.cjs` seeds a fabricated prior run (one
actionable 3a task + one degenerate-baseline 3d task), and `verify.cjs` checks the skill
made an instruction edit and stamped the run. It was scaffolded without a run-verify pass
(an agent eval costs credits), so confirm it locally with
`npm run eval:ablate -- .claude/skills/fix-instructions` before trusting its numbers. Per
the skill's Hard Rule 8, the seeded actionable row targets an unrelated rule, never the
harness or the skill itself (held-out / no self-optimization).

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
and `fix-tests-known-fix` tasks seed an error that *is* in `known-fixes.md` precisely so
that section has something to bite on; `fix-tests-low-quality-log` does the same for the
"Log quality gate" section (a stripped-traceback log). When you add a heavy section worth
testing, add a task that triggers it.
