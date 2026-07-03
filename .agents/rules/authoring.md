---
description: Conventions for authoring .claude rules and skills files
paths:
  - CLAUDE.md
  - "**/CLAUDE.md"
  - .claude/rules/**/*.md
  - .claude/skills/**/SKILL.md
---

# Rule: Rules & Skills Authoring

## Source of truth: `.claude/` over `.agents/`

`CLAUDE.md` and everything under `.claude/` are the **single source of truth**. The
`AGENTS.md` files and the `.agents/` tree are **generated mirrors** — a sync step copies
`CLAUDE.md` → `AGENTS.md` and `.claude/` → `.agents/` for harnesses that read those paths.

- **Only ever edit `.claude/` and `CLAUDE.md`.** Never hand-edit `.agents/**` or any
  `AGENTS.md` — those changes are overwritten on the next sync.
- **Treat the duplication as expected, not a defect.** Audits, reviews, and dedup passes
  should ignore `.agents/**` and `AGENTS.md` as mirror copies of `.claude/**` and `CLAUDE.md` —
  don't flag them as redundant or try to reconcile the two trees.

## Eval coverage is mandatory for instruction files

Instruction files are tested like code. The `evals/` promptfoo harness measures whether
a `CLAUDE.md`, a `.claude/rules/*` file, or a `.claude/skills/*` skill actually changes
agent behavior (with-instructions vs a leave-one-out ablation). **Treat a new or
substantially changed instruction file the same way you treat new code: it ships with a
test in the same change.**

- **New skill, or new/rewritten rule:** add an eval task under
  `evals/tasks/<name>/test.yaml` whose `metadata.targets` names the file, and whose
  prompt + asserts only pass when that file's guidance is in effect. This is the
  instruction-file analogue of the unit/integration-test mandate in the root `CLAUDE.md`.
- **Pick a discriminating prompt.** The task must measurably fail (or behave worse) when
  the file is ablated — otherwise it proves nothing. Verify with
  `npm run eval:ablate -- <path>`: the with-instructions arm should beat the ablated one.
- **`/skill` tasks need a `baselinePrompt`** (the skill's plain-English equivalent) so the
  ablated/baseline arm is a fair "skill vs unguided agent" comparison, not an unresolved
  command. Weight the correctness assert above the efficiency asserts (see any existing
  `test.yaml`).
- **Every task MUST declare `providers:`.** promptfoo runs a test against *all* top-level
  providers unless the test overrides them, so a task with no `providers:` line silently
  also runs on the Sonnet arms — doubling its cost for nothing. Simple read-only /
  single-edit tasks use `providers: [with-instructions, baseline-no-instructions]` (Haiku);
  only genuinely multi-step reasoning tasks opt into Sonnet with
  `providers: [with-instructions-capable, baseline-capable]`.
- **Fixer skills** (`fix-*`) follow the destructive-task template: a committed broken
  fixture under `evals/fixtures/`, a `setup.cjs` that seeds the skill's log artifact, and
  a `verify.cjs` that confirms the repair. Copy an existing `evals/tasks/fix-*/` as the
  starting point.
- **Run `npm run eval:coverage`** to confirm the file is no longer a gap.
- **Genuinely untestable by the harness?** A few skills can't be evaluated headless — they
  read live editor diagnostics (`fix-problems`) or are aggregate dispatchers with no
  behavior of their own (`fix-all`). Document the exclusion and the reason in
  `evals/README.md` rather than shipping a flaky test.

## CLAUDE.md files

- **Only record non-obvious configuration** — things that can't be derived by reading
  source files (e.g. proxy routes, port mappings, env var semantics, architectural
  constraints). If Claude can find it in a config file in one read, leave it out.

## Rules (`.claude/rules/`)

Every rule file must include YAML frontmatter so Claude can scope when it applies:

```yaml
---
description: One-line summary of what the rule covers
paths:
  - app/models/**/*.py
  - alembic/**/*.py
---
```

- `description` — brief, specific summary (used to decide relevance).
- `paths` — glob patterns for files the rule applies to. Omit only if the rule is
  truly global (rare).
- Keep rules focused on a single domain — don't mix unrelated conventions in one file.

### Skin rule files

One rule file per skin, named `.claude/rules/skin-<name>.md`.

- **Scope paths to the skin directory only** — never add global frontend paths:

  ```yaml
  paths:
    - frontend/src/skins/<name>/**/*.ts
    - frontend/src/skins/<name>/**/*.tsx
  ```

- **Visual properties as spec tables** — no JSX or CSS code blocks for
  material/animation/layout values. Use markdown tables:

  ```markdown
  | Property | Value | Notes |
  | --- | --- | --- |
  | `roughness` | `0.05` | near-mirror gloss |
  ```

  Structural code (scene hierarchy trees, very short class-name examples) may remain as
  code blocks where the structure itself conveys meaning.

### Security / scoping rules

Cross-cutting security rules (e.g. multi-tenant auth) belong in a scoped rule file, not
in `CLAUDE.md`. Scope them tightly:

```yaml
paths:
  - app/api/**/*.py
```

Then add a one-line pointer in `CLAUDE.md`'s guardrails cross-reference list.
See `.claude/rules/security.md` as the canonical example.

## Skills (`.claude/skills/`)

- Every skill frontmatter must include `disable-model-invocation: true`, **except
  skills that another skill invokes programmatically via the Skill tool** (orchestrated
  sub-skills). The flag blocks *all* Skill-tool invocation — including from a parent
  skill — so an orchestrated sub-skill must omit it or the parent's call fails with
  `cannot be used with Skill tool due to disable-model-invocation`. Currently `/fix-all`
  invokes `fix-tests`, `fix-e2e`, `fix-lint`, and `fix-docker`, and both `/fix-tests` and
  `/fix-e2e` delegate to `/fix-docker` when an `app/` restart breaks the stack — so those four
  omit the flag (with a comment in their frontmatter explaining why). Skills that are only ever
  started by the
  user — or merely *suggested* in another skill's prose ("re-run `/fix-tests`") — keep the
  flag.
- If the skill generates scripts, those scripts must follow the conventions
  in `.claude/rules/tooling.md` (especially `-T` for `docker compose exec`).


### Environment dependencies

A skill that depends on the local environment (Docker stack, running services, git
hooks, a browser runner) must say so in a one-line blockquote at the top of the
SKILL.md, e.g.:

```markdown
> Depends on the local Docker stack and its diagnostics being available.
```

Hooks are a Windows-local performance shortcut; they must never be the only path for
any step a skill needs to complete — skills use the Glob/Grep/Read/Write/Edit tools
directly and write state files (e.g. `state.json`) themselves rather than waiting on
a Stop hook.

### Hook output byte caps (token control)

When a hook or command placeholder emits command output that will be injected into
model context, cap output bytes by default to reduce token usage.

- Prefer a shared helper script in `scripts/hooks/` for capping and truncation markers
  instead of ad-hoc per-skill snippets.
- Do not keep only the first chunk when diagnostics matter. Prefer head+tail windows (or
  at minimum tail-on-error) so terminal errors near the end are preserved.
- Preserve exit-code semantics. Truncation wrappers must not mask command failures.
- Keep cap sizes explicit and small by default (for example, 4-8 KB), and raise only when
  diagnostics require a larger window.

### SKILL.md size limit

Keep `SKILL.md` under **500 lines**. If content exceeds this, apply progressive disclosure:

1. Extract reference material into a sibling file (e.g. `writing-conventions.md`)
2. Keep all references **one level deep** — `SKILL.md` → `reference.md` (never deeper)
3. Add a table of contents to any reference file longer than 100 lines
4. Use forward slashes in all file paths — never backslashes

### Fixer skill conventions (`fix-*`)

Skills that read a log artifact and fix the reported issues must follow these patterns
to prevent investigation spirals (where the model reads dozens of files without ever
making an edit):

#### 1. Known-fixes table (mandatory)

Every `fix-*` skill must have a sibling `known-fixes.md` file with this table format:

```markdown
| Error pattern (substring) | Root cause | Fix | Hits | Last used | Added |
```

- Patterns are plain substrings, not regex
- The skill updates **Hits** and **Last used** on every match
- Rows with **Hits = 0** older than 90 days from **Added** are pruned
- New rows are added only for patterns likely to recur

#### 2. Known-fix matching must be Step 1 — before any investigation

The skill must read the log artifact and `known-fixes.md` **in parallel** as its first
action. For every error that matches a known-fix pattern, the fix is applied immediately
as a one-shot — no additional file reads, no re-derivation. This is a **mandatory
short-circuit**, not a suggestion. Add it as a hard rule.

#### 3. Addressed marker

After applying fixes, append `--- ADDRESSED` to the log artifact. On the next
invocation, if the marker is present, tell the user to re-run the diagnostic task and
stop. The diagnostic task overwrites the file, naturally clearing the marker.

#### 4. Log-quality gate — both directions (mandatory)

A fixer must never fix *from* a bad artifact. When the log is unusable, the fix belongs in
the **producing script**, not the application code. Every `fix-*` SKILL.md must have a "Log
quality gate" section that blocks on **both** failure modes:

- **Missing detail** — a failure has no self-locating `file:line`, its traceback was stripped,
  or a summary names a failure with no matching block. Root cause is invisible; editing source
  would be a blind guess.
- **Drowning in noise** — the real failures are buried under content an agent can't act on:
  passing results, expected warnings, framework chatter (React `act(...)`, `PytestWarning`
  summaries), or a single non-source file flooding a section. The signal is unfindable.

In either case the skill must **not** touch application code. It edits the producing script
named on the artifact's `# source:` header (or the shared filter in `scripts/diagnostics.py`)
to widen the capture or tighten the noise, updates that script's test in the **same** change
(`scripts/hooks/tests/test_diagnostics.py` for the lint/test runners), tells the user to
regenerate the artifact, and stops. "Don't waste time on suboptimal logs" is the whole point of
this gate — state it as a hard rule in the skill.
