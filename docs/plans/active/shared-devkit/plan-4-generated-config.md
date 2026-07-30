# Plan 4 — Managed config: adopt the pre-commit channel, decide the rendered tier

**Depends on:** the devkit tag from Plan 2's "Prerequisite" (shared blocker). Otherwise
independent of Plan 2 — nothing here needs a pip package, because there is not one.
**Read first:** `docs/plans/active/shared-devkit/README.md`.

> **Reconciled 2026-07-29.** This plan was written against devkit `v0.2.0` and proposed a
> `devkit sync` console script rendering base+overlay templates into every repo, gated by a
> CI drift job. Since then upstream **shipped the pre-commit channel outright** and **built
> a template renderer with deliberately different semantics** — no overlays, no merging.
> One third of this plan is done, one third needs re-scoping around what the renderer will
> and will not do, and one third should be dropped. Details below; nothing is deleted
> silently.

## What already exists upstream

### Done — the pre-commit channel

`.pre-commit-hooks.yaml` exists and publishes three hooks. This is the row the original
plan called out as "the one category with a native sharing mechanism — don't generate what
pre-commit can already fetch." That instinct was right and upstream executed it:

| Hook | Catches |
| --- | --- |
| `devkit-manifest` | A `.devkit.toml` the harness would silently ignore — unparseable TOML, a path prefix missing its trailing slash, a declared directory that does not exist, a half-filled `[db]`/`[frontend]` block |
| `devkit-hooks-stdlib-only` | A third-party import in `scripts/hooks/`. Cannot be caught by a test suite, because the suite runs *inside* the virtualenv these scripts run before |
| `devkit-drift` | A vendored file differing from the pinned devkit rev |

`devkit-drift` is the important one: it **fixes the inert-gate problem for real.**
`sync-devkit.py --check` resolves its source from `$DEVKIT_DIR` and exits 0 doing
nothing when that is unset — indistinguishable from success in a log, which is exactly how
Carameli's gate passed green for months while checking nothing. Run through pre-commit
there is nothing to configure: pre-commit has already cloned devkit at the pinned rev, and
that rev is written down in the consumer's config and moved by `pre-commit autoupdate`.

**Carameli has not adopted this.** Its `.pre-commit-config.yaml` contains no devkit `repo:`
entry. That is Step 1.

### Built, but not what this plan assumed — the renderer

`scripts/devkit_render.py` is a stdlib-only template renderer over `templates/core/` and
`templates/features/`. It supports exactly two things:

- `{{ name }}` substitution — an unknown name **raises**, so a typo fails the render
  instead of emitting an empty string into a compose file
- `{{#flag}}` / `{{^flag}}` / `{{/flag}}` whole-line blocks, which nest

It supports **no merging of any kind**. That is a deliberate constraint, not a gap: block
tags must stand alone on their line so a disabled block removes whole lines and leaves
valid syntax behind. Its consumer is `new-project.py` — a **one-shot generator** whose
default is a dry run, and which pointedly **prints** the `ports.toml` lines to add rather
than writing them, because "a tool that silently commits to its own source of truth is how
two sessions hand out one slot twice."

## The design conflict this plan has to resolve

The original Step 1 specified base + overlay with "YAML dict-merge for dependabot, TOML for
ruff, JSON array-append for tasks.json". **Nothing upstream does this, and the renderer was
built in a style that argues against it.** Delivering the plan as written means either:

- **(a) Build the merge layer anyway** — three format-specific mergers, in a codebase whose
  stated contract is stdlib-only and whose renderer author explicitly chose whole-line
  conditionals over anything cleverer. The plan's own warning applies to itself: "a clever
  merger that silently drops a key is worse than no sharing."
- **(b) Narrow the scope** to what the existing mechanisms already cover.

**Recommendation: (b).** Retrofitting a renderer over a live repo's hand-tuned config is
the expensive half of this plan and the half with the least payoff — Carameli's `ruff.toml`
and `dependabot.yml` are stable files that change a few times a year, not a drift risk
worth three mergers and a CI job.

## The three-way split (replaces the original single table)

| Tier | Files | Mechanism | Action for Carameli |
| --- | --- | --- | --- |
| **Fetched** | `.pre-commit-config.yaml` hook entries | pre-commit `repo:` + `rev:` — native, already shipped | **Adopt** (Step 1) |
| **Seeded** | `ruff.toml`, `.gitattributes`, `.editorconfig`, `.markdownlint.json`, `.yamllint.yaml`, `.vscode/tasks.json` | `devkit_render.py` templates, rendered once into *new* projects | **Diff against upstream, hand-reconcile, do not wire a renderer** (Step 2) |
| **Project-owned** | `.github/dependabot.yml` | none — stays a literal file | **Drop from scope; test the invariants instead** (Step 3) |

## Step 1 — Adopt the pre-commit channel

> **Verified 2026-07-30.** Carameli's `.pre-commit-config.yaml` still has no devkit `repo:`
> entry — only two `repo: local` hooks (`sync-agents`, `detect-secrets`). This step is
> untouched. Note the config's own header says every lint/type check is CI-owned and
> "nothing here may be slow"; the three devkit hooks fit that (a TOML parse, an import
> scan, and a byte-compare), but say so in the commit or the next reader will read them as
> a violation of the file's stated policy.

Blocked on **Plan 0**, now its own file: devkit's tags stop at `v0.4.1` (commit `4fbda17`),
and `git ls-tree -r --name-only v0.4.1` confirms that tree carries neither
`.pre-commit-hooks.yaml` nor `scripts/precommit/`. **A rev that predates the channel fails
hard**: pre-commit resolves hook ids strictly, so against an older tag the first commit
aborts with "hook not found" rather than skipping. This is the same defect Plan 0 fixes for
generated projects — adopting here before the tag exists reproduces it in Carameli by hand.

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/alexandrec90/devkit
    rev: v0.5.0 # must be a tag that actually carries .pre-commit-hooks.yaml
    hooks:
      - id: devkit-manifest
      - id: devkit-hooks-stdlib-only
      - id: devkit-drift
```

Then decide what happens to the PR gate's `sync-devkit.py --check` step. Recommendation:
**keep both.** They fail differently — `devkit-drift` catches it at commit time against
the pinned rev, `--check` catches it in CI against the checked-out tag — and the CI one is
what protects against a bypassed local hook, which is the same argument the existing
`mirror-sync` job rests on.

Watch the executable bit: the hooks are `language: script`, so a missing `+x` fails only on
a consumer's machine, at commit time, after the rev is tagged.

## Step 2 — Reconcile the seeded files by hand, once

For each Seeded file: diff Carameli's against the upstream template rendered with
Carameli's flags (`--preset fullstack`), and treat differences as a question, not a bug —
some are Carameli's tool set and should stay. Record the verdict per file in this document
so the next session does not redo the diff.

**Do not** add a `devkit sync --check` job for this tier. Without a merge layer, a drift
gate over hand-tuned config can only ever say "these differ", which is already true and
intended. Revisit only if a second existing repo adopts devkit and the same divergence
shows up twice.

## Step 3 — `dependabot.yml`: drop from scope, test the invariants

The original plan flagged the real risk itself: the `lint-typecheck-toolchain`,
`stylelint-toolchain`, and `test-env` groups exist because of specific compatibility
incidents, the frontend `cooldown: semver-major-days: 30` is deliberate, and losing the
`python` semver-major/minor ignore rule "would re-break the container lock — that ignore
exists because PR #43 auto-merged a 3.12→3.14 bump."

With no merge layer, generating this file can only flatten those or hard-code Carameli's
specifics into a shared template. Both are worse than leaving it alone. Instead, protect
the invariants directly with a Carameli test asserting:

- the `python` package ecosystem ignores `version-update:semver-major` and `semver-minor`
- the three named groups are present
- the frontend cooldown is unchanged

That is cheap, catches the actual failure mode (a Dependabot PR or an agent editing the
file), and needs no shared machinery. Related standing risk: the
`dependabot-strips-lock-markers` recurrence — see `dependabot-lock-repair.yml`, which Plan
3 covers.

## Step 4 — `lint-policy.md`: superseded, write it upstream

> **Verified 2026-07-30: not started.** `.claude/rules/engineering.md` at devkit HEAD has
> five sections — Testing, Scripts, Failure artifacts, The vendored agent harness, and the
> instruction-file feedback loop. **No lint section.** This step is entirely open, and it is
> the cheapest item in this plan set: one section in one already-vendored file, which
> reaches every consumer on their next `--pull`.
>
> Sequencing note: write it **before** Plan 2 Step 1 if convenient. `engineering.md` is one
> of the 21 entries Carameli is about to pull, so landing the lint section upstream first
> means Carameli receives it in the same pull instead of needing a second one.

The original Step 2 called for a `rules/lint-policy.md` in the Plan-1 plugin. **There is no
plugin, and there is now a better home**: devkit vendors `.claude/rules/engineering.md`
byte-identical into every consumer, and it already covers testing, scripts, the harness
seam, and the instruction-feedback loop. The lint policy belongs there.

Write it **upstream in devkit**, not as a new Carameli file — a Carameli copy would be the
fork that nothing drift-checks, which is precisely the failure the instruction tier exists
to prevent. Content is unchanged from the original:

- which rule families are on and why (correctness/security in, style/formatting out)
- never silence a finding with `# noqa` / `type: ignore` without a comment naming the reason
- the escalation path when a linter is wrong: fix the producer, or report to the user with
  concrete options — **never skip, never call an error "cosmetic"**

The last point matches standing feedback (`feedback-never-skip-never-cosmetic`) and is
worth having in the shared tier so every project inherits it.

## Tests

- Step 1: a Carameli test asserting `.pre-commit-config.yaml` pins devkit by **tag** (not a
  branch) and lists all three hook ids. Cheap, and catches a silent revert.
- Step 1: verify `devkit-drift` actually fires — hand-edit a MANIFEST file, confirm the
  commit aborts, revert. A gate nobody has seen fail is a gate nobody knows works.
- Step 3: the dependabot invariant test described above.
- Keep `test_check_lock_markers.py` passing throughout.
- **No** round-trip render tests — there is nothing being rendered into Carameli.

## Definition of done

- [ ] devkit tagged with `.pre-commit-hooks.yaml` in it (shared prerequisite with Plan 2)
- [ ] Carameli's `.pre-commit-config.yaml` pins that tag and enables all three hooks
- [ ] `devkit-drift` observed failing on a deliberate edit, then reverted
- [ ] PR gate keeps its `sync-devkit.py --check` step alongside the pre-commit hook
- [ ] Every Seeded file diffed against its upstream template, verdict recorded in this file
- [ ] Dependabot invariant test added and green; `dependabot.yml` left project-owned
- [ ] Lint policy written into devkit's `.claude/rules/engineering.md`, not a Carameli file

**Deliberately not in scope any more:** `devkit sync` / `devkit sync --check`, base+overlay
merge semantics, GENERATED headers, a rendered-config drift job, a generated
`dependabot.yml`, a Carameli `lint-policy.md`.
