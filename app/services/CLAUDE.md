# Services

## Architecture

```text
Handler (app/api/)  →  Service (app/services/)  →  Repository (app/repositories/)
       ↕                                                     ↕
  Provider (app.state.carrier / app.state.engine)         Database
```

- **Handlers** own auth, request parsing, provider calls, HTTP error responses, and logging.
- **Services** are thin function modules (not classes) that delegate to repositories. They contain no business logic beyond simple pass-through.
- **Repositories** own all ORM operations and call `session.commit()` internally.

## Provider Boundary

Two Protocols in `providers/base.py` define the external boundary:

| Protocol | Implementation | Responsibility |
| --- | --- | --- |
| `CarrierProvider` | `carrier/telnyx.py` | DID provisioning, SMS, area codes |
| `CallEngineProvider` | `engine/jambonz.py` | Call control, recording, voicemail drop |

Providers are instantiated by factory functions in `providers/factory.py` and stored on `app.state` at startup. Handlers access them via `request.app.state.carrier` / `request.app.state.engine`.

**Key rule**: Services never call providers directly. Provider calls happen in handlers.

## Adding a New Service

1. Create `app/services/<entity>_service.py` as a module with plain async functions.
2. Each function takes `session: AsyncSession` as its first argument and delegates to a repo.
3. Import the service module in the handler (not individual functions):
   `from app.services import phone_line_service`

## Background Jobs

`call_sync.py` is the only service that breaks the thin-wrapper pattern — it runs as an ARQ cron job (every 30 s) that retries posting unposted `CallEvent` records to VanillaSoft. It manages its own sessions via `async_session_factory`.
