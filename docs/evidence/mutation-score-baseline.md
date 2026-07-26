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
| TBD | TBD | TBD | TBD | TBD | TBD |

## Target

- Initial target: > 80% killed mutations across scoped files.

## Surviving mutants log

| Mutant ID | File | Mutation summary | Test added/fixed | Status |
| --- | --- | --- | --- | --- |
| TBD | TBD | TBD | TBD | Open |

## Update workflow

1. Run `mutmut run`.
2. Review with `mutmut results` and `mutmut show <id>`.
3. Add/adjust tests for survivors.
4. Re-run and update this baseline table.
