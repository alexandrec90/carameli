# Services and providers

Services own application workflows; repositories own persistence. Simple entity
services may be thin wrappers, while reconciliation, retention, recording links, and
ARQ jobs legitimately coordinate several operations.

Provider contracts live in `providers/base.py`:

| Protocol | Active implementation | Responsibility |
| --- | --- | --- |
| `CarrierProvider` | `carrier/telnyx.py` | DIDs, SMS, area codes, carrier records |
| `CallEngineProvider` | `engine/jambonz.py` | call control, SIP state, recordings |

- HTTP handlers use the provider instances stored on `request.app.state`.
- Worker workflows accept Protocol-typed providers or create them once during ARQ
  startup; never construct a provider client per job item.
- Only `providers/factory.py` may select/import a concrete implementation.
- Tests mock the Protocol boundary, not internal services or repositories.
- ARQ jobs create their own sessions with `async_session_factory`; ordinary services
  receive an `AsyncSession` from their caller.
