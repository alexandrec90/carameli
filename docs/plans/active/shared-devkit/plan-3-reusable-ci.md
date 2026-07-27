# Plan 3 — Reusable CI workflows and composite actions

**Depends on:** nothing (independent of Plans 1 and 2). **Parallel with:** Plan 1.
**Read first:** `docs/plans/active/shared-devkit/README.md`.

## Goal

Turn Carameli's 7 workflows and 2 composite actions into a reusable CI layer hosted in
`devkit`, so a new project gets the same PR gate, Dependabot automation, and scheduled
runs by writing a ~15-line caller workflow.

## Current inventory

| Workflow | Lines | Reusable? |
| --- | --- | --- |
| `pr-gate.yml` | 210 | yes — the main prize (jobs: backend, lint, mirror-sync) |
| `dependabot-automerge.yml` | 117 | yes — the major/minor classifier is fully generic |
| `dependabot-lock-repair.yml` | 141 | yes — see the `dependabot-strips-lock-markers` memory |
| `nightly.yml` | 123 | partly — schedule + free-tier discipline generic, jobs project-specific |
| `weekly.yml` | 223 | partly — same |
| `on-demand.yml` | 127 | partly — **note:** its auto-commit step is unwanted (see `ci-autofix-retired` memory); drop it during extraction rather than porting it |
| `sandbox-tests.yml` | 96 | no — Telnyx sandbox, stays in Carameli |
| `ci.yml.disabled`, `e2e-smoke.yml.disabled` | — | delete or revive; do not port disabled files |
| `actions/setup-python-env`, `actions/setup-node-env` | composite | yes — already the right shape |

## Step 1 — Composite actions first

These are the lowest-risk extraction and everything else depends on them. Move
`setup-python-env` and `setup-node-env` to `devkit/.github/actions/`. Add inputs for the
Python version and lock file paths rather than hardcoding 3.12 and `requirements*.txt`.

Callers reference them as `uses: alexandrec90/devkit/.github/actions/setup-python-env@v1`.

## Step 2 — Parameterize `pr-gate.yml`

Convert to `on: workflow_call` with inputs covering everything currently hardcoded:

```yaml
on:
  workflow_call:
    inputs:
      python-version:      { type: string, default: "3.12" }
      postgres-image:      { type: string, default: "postgres:18" }
      postgres-user:       { type: string, default: "app" }
      postgres-db:         { type: string, default: "app" }
      needs-redis:         { type: boolean, default: true }
      unit-test-path:      { type: string, default: "tests/unit/" }
      integration-tests:   { type: string, default: "" }
      run-mirror-sync:     { type: boolean, default: true }
      run-frontend-lint:   { type: boolean, default: true }
    secrets:
      # only if a job genuinely needs one; PR Gate today needs none
```

Preserve these properties exactly — they are hard-won and easy to lose in a rewrite:

- `permissions: contents: read` at workflow level, least-privilege
- `concurrency` keyed on `${{ github.workflow }}-${{ github.ref }}` with
  `cancel-in-progress: true`, and the reasoning about `refs/heads/…` vs `refs/pull/N/merge`
  not colliding (keep the comment)
- The `-m "not paid"` marker on integration tests — redundant with `pytest.ini` but
  deliberately explicit so the gate can never hit a live provider
- `actionlint` install failing loudly rather than silently skipping
- `if: always()` on artifact upload

Carameli's caller shrinks to:

```yaml
name: PR Gate
on:
  pull_request: { branches: [master] }
  workflow_dispatch:
jobs:
  gate:
    uses: alexandrec90/devkit/.github/workflows/pr-gate.yml@v1
    with:
      postgres-user: carameli
      postgres-db: carameli
      integration-tests: "tests/integration/test_full_flows.py tests/integration/test_contract.py tests/integration/test_schema_indexes.py"
```

## Step 3 — Dependabot automation

`dependabot-automerge.yml` and `dependabot-lock-repair.yml` are the highest-value
extraction after the gate: they encode two real incidents.

- The auto-merge classifier gates majors for manual review and waits on PR Gate before
  merging (this repo's plan has no branch protection — the workflow *is* the gate).
- The lock-repair workflow exists because Dependabot pip group bumps strip environment
  markers from `requirements*.txt`, breaking Windows installs. Recurrence risk rises with
  auto-merge enabled. Both behaviours must survive the move verbatim.

Note `dependabot.yml` itself **cannot** be reusable — GitHub only reads a literal file at
`.github/dependabot.yml`. It becomes a Plan 4 generated template.

## Step 4 — Scheduled workflows

`nightly.yml` and `weekly.yml` split: extract the shared scaffolding (schedule,
concurrency, free-tier-only discipline, artifact upload) as a reusable workflow; keep the
project-specific job bodies in Carameli. There is an existing test —
`test_scheduled_workflows_free.py` — asserting these stay on the free tier. It moves with
the scaffolding and must keep passing.

## Cross-repo constraints to verify before starting

- **Private repos: not a concern — settled.** `alexandrec90/devkit` (the renamed
  `agent-harness`) is **public**, so cross-repo reusable-workflow calls need no
  Actions-access configuration and CI checkouts of it need no token. Keep it public; going
  private later would re-open this and also break the vendored tier's CI checkout (README,
  "The drift gate must actually gate").
- **Nesting limit:** reusable workflows nest up to 4 levels. This design uses 1. Fine.
- **`uses:` refs are Dependabot-bumpable** under the `github-actions` ecosystem — so
  pinning `@v1` here does get maintained automatically, unlike the pip pin in Plan 2.

## Tests

- `test_ci_workflow_conventions.py` and `test_scheduled_workflows_free.py` (both exist
  today in `scripts/hooks/tests/`) move to devkit and must pass against the reusable
  workflows.
- Add a devkit test asserting every `workflow_call` input has a default or is documented
  as required — a missing default silently breaks a consumer.
- Verify end to end by opening a throwaway PR in Carameli and confirming the gate runs
  through the reusable workflow with identical job names and outcomes.

## Definition of done

- [ ] Composite actions in devkit, parameterized, consumed by Carameli
- [ ] `pr-gate.yml` is a `workflow_call` workflow; Carameli's caller is <25 lines
- [ ] All preserved properties above verified present (permissions, concurrency, markers)
- [ ] Dependabot auto-merge + lock-repair extracted with behaviour unchanged
- [ ] `on-demand.yml`'s auto-commit step dropped, not ported
- [ ] Disabled workflow files deleted or revived — not carried forward as `.disabled`
- [ ] A real PR in Carameli runs green through the reusable gate
