---
description: Backend structured logging conventions (Python / FastAPI)
paths:
  - app/**/*.py
  - tests/**/*.py
---

# Rule: Backend Logging

Every module must emit structured logs to `logs/runtime/carameli.log`.

## Setup

Configured once at startup in `app/main.py`:

```python
from app.core.logging_config import configure_logging
configure_logging(log_level=settings.log_level, log_file=settings.log_file)
```

`app/core/logging_config.py` attaches two handlers to the root logger:

- **Console** (`StreamHandler`) — for docker logs / terminal
- **RotatingFileHandler** — `logs/runtime/carameli.log`, 10 MB cap, 5 backups

## Log format

```text
2026-02-21 14:30:00.123 | INFO     | app.api.vsapi.phone_lines:56 | Phone line added number=+15551234567 sid=PN...
```

Fields: `timestamp.ms | LEVEL | module:lineno | message`.

## Per-module logger

Declare at module scope — never inside a function:

```python
import logging
logger = logging.getLogger(__name__)
```

## Route handler events

| Event | Level | Required fields |
| --- | --- | --- |
| Handler entry | `INFO` | all key identifiers (customer ID, phone number, ext, etc.) |
| 404 / 409 not found / conflict | `WARNING` | the missing identifier |
| Provider error | `ERROR` | `vs_customer_id`, target number, provider error details |
| Validation / bad-request error | `WARNING` | the offending value |
| Successful mutation | `INFO` | result identifiers (new ID, SID, etc.) |

```python
logger.info("Adding phone line vs_customer_id=%s area_code=%s number=%s", body.vs_customer_id, body.area_code, body.phone_number)
logger.warning("Customer not found vs_customer_id=%s", body.vs_customer_id)
logger.error("Provider error purchasing DID vs_customer_id=%s: %s", body.vs_customer_id, exc)
logger.info("Phone line added number=%s sid=%s", line.phone_number, line.provider_sid)
```

## Config

| Variable | Default | Purpose |
| --- | --- | --- |
| `LOG_LEVEL` | `INFO` | Root log level |
| `LOG_FILE` | `logs/runtime/carameli.log` | Path for the rotating file |

## Hard Rules

1. **Never `print()`** — use `logger.*()`.
2. **Never f-strings in log calls** — use `%s` lazy formatting.
3. **Every new route handler** must log entry at `INFO` and failures at `WARNING`/`ERROR`.
4. **Do not log secrets** — log the identifier (SID, customer ID) instead.
5. **Do not create new log files** — everything goes to `logs/runtime/carameli.log`.
