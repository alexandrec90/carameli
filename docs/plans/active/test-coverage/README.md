# Test coverage — multi-session tracks

Five tracks that close Carameli's test-coverage gaps. Each track file is self-contained (a
fresh session starts cold); sessions inside a track are sequential unless the file says
otherwise.

## Dependency order

```text
Track A (backend unit) ──┬──► Track D (observability, parity, perf, mutation)
Track B (frontend) ──────┘         │
                                   ▼
Track E (CI wiring): E1 after A, E2 after A+B+C+D
Track C (provider) ──────────────► (independent; needs credentials — see its section 0B)
```

| Track | Delivers | Requires |
| --- | --- | --- |
| [A — backend unit gaps](track-a-backend-unit-gaps.md) | Five sessions extending `tests/unit/` | Standard Docker stack (Postgres + Redis) |
| [B — frontend](track-b-frontend.md) | B1 Vitest unit/component tests; B2 cross-browser Playwright | None (independent of backend) |
| [C — provider integration](track-c-provider.md) | C1 Telnyx sandbox suite; C2 resilience/chaos tests | Full stack; C1 needs real Telnyx sandbox credentials |
| [D — tooling](track-d-tooling.md) | Four sessions: observability, parity, performance, mutation testing | Tracks A and B complete |
| [E — CI wiring](track-e-ci.md) | E1 wires the unit gate; E2 wires the full matrix | E1 after A; E2 after A–D |

Conventions for writing the tests themselves live at the top of each track file — read them
before writing a line of test code.
