# Mutation score baseline

Track D4 baseline for `mutmut` on high-risk business logic modules.

## Scope

- `app/services/call_sync.py`
- `app/services/agent_status_sync.py`
- `app/api/webhooks/call_status.py`
- `app/api/webhooks/sms_inbound.py`
- `app/core/session.py`

## Baseline run

| Run date | Killed | Survived | Timeout | Suspicious | Mutation score |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2026-10-25 | 651 | 314 | 0 | 0 | 67.5% |

The first run that mutated anything: the `setup.cfg` before it named its five files as one
comma-joined path, so every earlier weekly run mutated nothing and reported N/A. Measured
in a Linux container on the `setup.cfg` configuration with `--max-children 1`, the way
the weekly `mutation` job runs. A parallel run on the same tree scored 74.2%, because
workers sharing the one test database TRUNCATE each other's rows mid-test.

Survivors by module:

| Module | Survived |
| --- | ---: |
| `app/api/webhooks/sms_inbound.py` | 125 |
| `app/services/agent_status_sync.py` | 77 |
| `app/api/webhooks/call_status.py` | 75 |
| `app/services/call_sync.py` | 32 |
| `app/core/session.py` | 5 |

Each weekly run reports the current figures on its run summary page.

## Target

- Initial target: > 80% killed mutations across scoped files.

## Surviving mutants log

| Mutant ID | File | Mutation summary | Test added/fixed | Status |
| --- | --- | --- | --- | --- |
| TBD | TBD | TBD | TBD | Open |

## Update workflow

1. Run `mutmut run --max-children 1` on Linux or WSL (mutmut 3 needs `fork`) with
   `DATABASE_URL` pointing at a disposable `*_test` database.
2. Review with `mutmut results` and `mutmut show <name>`.
3. Add/adjust tests for survivors.
4. Re-run and update this baseline table.
