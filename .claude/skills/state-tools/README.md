# State Tools (Unified `state.json` Engine)

Two scripts, two subcommands, no per-skill configs. State-driven skills follow the same flow:

1. (audit only) Generate a scan plan with `state-engine.py plan`
2. Generate a per-skill artifact (`scan-results.json` or `state-updates.json`)
3. The session `Stop` hook fires `finalize-state.py`, which calls `state-engine.py
   apply` and removes the artifact

## Files

- `state-engine.py` — `plan` (audit) + `apply` (all schemas) subcommands
- `finalize-state.py` — `Stop`-hook wrapper (in `scripts/hooks/`): gates on
  artifact existence,
  calls `apply`, cleans up artifacts on success
- `README.md`

## Schemas

| Schema | Skills | Tracks |
| --- | --- | --- |
| `audit` | `audit-design-flaws` | `checks.<id>.files.<path>` records (per-check, per-file fingerprints + statuses `pass`/`violation`/`fixed`/`stale`) |
| `modules` | `make-tests`, `make-frontend-tests` | `modules[]` rows keyed by `module` |
| `files` | `refactor` | `files.{path}` map |

## Conventional paths

For skill `<name>`, the engine derives:

| File | Used by | Written by |
| --- | --- | --- |
| `.claude/skills/<name>/state.json` | all | engine (`apply`) |
| `.claude/skills/<name>/scan-plan.json` | audit | engine (`plan`) |
| `.claude/skills/<name>/scan-results.json` | audit | skill agent |
| `.claude/skills/<name>/state-updates.json` | modules / files | skill agent |

Override any of these with `--state-file`, `--out`, `--scan-plan`, `--results-file`,
or `--updates-file` if a skill needs something custom.

## Usage

The skill agent only invokes `plan` (audit only); `apply` runs through the hook.

```sh
# Build incremental scan plan (audit schema only — agent runs this)
python .claude/skills/state-tools/state-engine.py plan --skill audit-design-flaws
```

The session `Stop` hook (`scripts/hooks/stop.py`) calls `finalize-state.py`, which
is the only place `apply` is invoked:

```bash
python3 scripts/hooks/finalize-state.py --skill <skill-name> --schema <audit|modules|files>
```

Common flags on `state-engine.py` (both subcommands): `--repo-root`, `--skill`,
`--state-file`, `--out`. `apply` adds `--schema`, `--today`, plus per-schema
overrides (`--scan-plan`, `--results-file`, `--updates-file`).

## Hook flow

The session `Stop` hook in `.claude/settings.json` runs `scripts/hooks/stop.py`,
which finalizes every state-driven skill:

```bash
python3 scripts/hooks/finalize-state.py --skill <name> --schema <schema>
```

`finalize-state.py` is idempotent and gated on artifact existence:

1. If `<artifact>.json` doesn't exist → exit 0 (no-op, fires harmlessly on
   every Stop while the skill is active).
2. Otherwise → call `state-engine.py apply`, then delete the input artifact(s)
   on success.

This means the agent can write `scan-results.json` / `state-updates.json` and
finish its turn — `apply` runs automatically. No agent action can skip it.

## Run artifacts expected

### `audit` schema — `scan-results.json`

```json
{
  "checks": {
    "A": {
      "files": {
        "frontend/src/example.ts": "violation",
        "app/example.py": {
          "status": "fixed",
          "summary": "split helper into app/core/helpers.py"
        }
      }
    }
  }
}
```

### `modules` schema — `state-updates.json`

```json
{
  "last_run": "YYYY-MM-DD",
  "modules": [
    {
      "module": "app/api/vsapi/sms.py",
      "test_file": "tests/unit/test_sms.py",
      "last_reviewed": "YYYY-MM-DD",
      "git_hash": "<sha-or-UNCOMMITTED>",
      "gaps_found": 0
    }
  ]
}
```

### `files` schema — `state-updates.json`

```json
{
  "files": {
    "frontend/src/pages/DashboardPage.tsx": {
      "git_hash": "<sha-or-UNCOMMITTED>",
      "refactored_at": "YYYY-MM-DD"
    }
  }
}
```

## Notes

- `audit-design-flaws` treats `fixed` as final for unchanged files.
- The audit planner's `CHECK_SPECS` (file globs per check) live in `state-engine.py` —
  if a second audit-schema skill is added, factor specs into a config rather than
  forking the script.
- Keep run artifacts deterministic; the engine merges, it does not infer.
- If adding a new state-driven skill: pick an existing schema and call `apply
  --skill <name> --schema <schema>`. No new files needed.
