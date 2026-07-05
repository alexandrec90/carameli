from __future__ import annotations

import logging

from app.core.redis import get_redis_client

logger = logging.getLogger(__name__)

# Pending two-leg callback state (agent_call_sid -> contact_number) lives in
# Redis so it survives restarts and works across replicas. Entries expire after
# the TTL — if the agent has not answered by then, the callback is abandoned.
PENDING_CALLBACK_TTL_SECONDS = 600

_KEY_PREFIX = "carameli:pending_callback:"


async def set_pending_callback(call_sid: str, contact_number: str) -> None:
    """Store the contact number to bridge once the agent leg answers."""
    client = get_redis_client()
    try:
        await client.set(_KEY_PREFIX + call_sid, contact_number, ex=PENDING_CALLBACK_TTL_SECONDS)
    finally:
        await client.aclose()


async def pop_pending_callback(call_sid: str) -> str | None:
    """Atomically fetch-and-delete the pending contact number, if any."""
    client = get_redis_client()
    try:
        value: str | None = await client.getdel(_KEY_PREFIX + call_sid)
    finally:
        await client.aclose()
    return value
