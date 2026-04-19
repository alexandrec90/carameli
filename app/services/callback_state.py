from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)

# Pending callback state: maps agent_call_sid -> contact_number.
# Protected by an asyncio.Lock so concurrent initiations are safe.
# NOTE: this dict is process-local and resets on worker restart. A multi-worker
# deployment should use a shared store (e.g. Redis).
pending_callbacks: dict[str, str] = {}
pending_callbacks_lock = asyncio.Lock()
