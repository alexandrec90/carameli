# Fixer feedback loop — multi-session plan

Builds a closed-loop, cost-aware fixer-optimization system on top of the
Stop-hook profile. **Plan 1 (outcome capture) is already implemented and merged into
the working tree** — Plans 2–4 below are handoffs for fresh sessions.

Each plan file is self-contained (a fresh session starts cold). Read this README
first for the shared data contract, then the plan you're executing.

## Dependency order

```text
Plan 1 (DONE) ──► Plan 2 (optimize-fixers consumes outcomes)
              └─► Plan 3 (triage report)  ──► Plan 4 (auto-generate promptfoo fixtures)
```

Plan 1 must be merged before any of these. Plans 2 and 3 are independent of each
other and can run in parallel. Plan 4 depends on Plan 3.

## What Plan 1 delivered (the shared contract)

Implemented in `scripts/hooks/archive-session.py` (+ `stop.py` wiring), with tests in
`scripts/hooks/tests/test_archive_session_outcomes.py` and `_tokens.py`.

### `logs/agent/error-ledger.json`

Links every error a fixer saw to whether a later run resolved it. Keyed `"<skill>::<signature>"`:

```json
{
  "fix-tests::FAILED tests/unit/test_a.py::test_a - assert 1 == 2": {
    "skill": "fix-tests",
    "signature": "FAILED tests/unit/test_a.py::test_a - assert 1 == 2",
    "first_seen": "2026-06-26",
    "last_seen": "2026-06-27",
    "attempts": 1,
    "status": "fixed",          // open | fixed | recurring
    "last_commit": "abc123",     // short SHA of the fix attempt ('' if no git)
    "fixed_on": "2026-06-27"     // present only when status == fixed
  }
}
```

State machine (see `reconcile_outcomes`):

- new signature → `open`
- seen again after `fixed` → `recurring` (the fix didn't hold / flaky)
- gone from a fresh read after ≥1 attempt → `fixed`
- vanished with **no** attempt → stays `open` (not credited)

### `logs/agent/skills-profile.json` additions (per fixer skill)

- **Token cost:** `avg_tokens`, `total_output_tokens`, `total_input_tokens`,
  `total_cache_read_tokens`, `total_cache_creation_tokens`, `tokens_history` (last 50).
- **Outcomes:** `fix_outcomes: { fixed, recurring, open, success_rate }`
  (success_rate = fixed / (fixed+recurring+open), 0.0 when none).

> ⚠️ Interpretation caveat (carry into every plan): per-segment `input`/`cache_read`
> tokens reflect the **ambient session context**, not the skill's own cost. Act only on
> **output tokens** and **trends**. This is already documented in optimize-fixers 3f.

## Project rules every plan must honor

- Every code change ships tests in the same commit (`.claude/rules/tooling.md` for hook
  scripts → `scripts/hooks/tests/`).
- New/changed skill or rule ships an eval task (`.claude/rules/authoring.md`):
  `evals/tasks/<name>/test.yaml` with `metadata.targets` + `providers:`. Run
  `npm run eval:coverage` to confirm no gap.
- optimize-fixers **Hard Rule 5**: max 3 file reads (SKILL.md + known-fixes.md +
  profile). Anything a plan wants the skill to consume must live **in the profile** —
  not in a 4th file. This drives several design choices below.
