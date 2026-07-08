from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol, runtime_checkable

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ProviderCallRecord:
    """A recent call as reported by the call engine's own records.

    Used by the reconciliation cron to diff provider-side calls against local
    ``call_events`` rows. ``call_sid`` is the same identifier the call-status
    webhook delivers, so it can be matched directly.
    """

    call_sid: str
    direction: str | None
    from_number: str | None
    to_number: str | None
    started_at: datetime | None
    status: str | None


@dataclass(frozen=True)
class ProviderMessageRecord:
    """A recent message as reported by the carrier's own records.

    Used by the reconciliation cron to diff provider-side messages against local
    ``sms_messages`` rows. ``message_sid`` is the same identifier the inbound-SMS
    webhook delivers.
    """

    message_sid: str
    direction: str | None
    from_number: str | None
    to_number: str | None
    created_at: datetime | None
    status: str | None


@runtime_checkable
class CarrierProvider(Protocol):
    async def search_numbers(
        self, area_code: str, count: int, country_code: str = "US"
    ) -> list[dict]: ...
    async def provision_number(self, number: str, country_code: str = "US") -> dict: ...
    async def release_number(self, provider_sid: str) -> None: ...
    async def send_sms(self, from_: str, to: str, body: str) -> dict: ...
    async def enable_sms(self, provider_sid: str) -> None: ...
    async def disable_sms(self, provider_sid: str) -> None: ...
    async def get_available_area_codes(self, country: str, state: str | None) -> list[dict]: ...
    async def list_recent_messages(self, since: datetime) -> list[ProviderMessageRecord]: ...


@runtime_checkable
class CallEngineProvider(Protocol):
    async def initiate_call(self, from_: str, to: str, webhook_url: str, **opts) -> dict: ...
    async def hangup_call(self, call_id: str) -> None: ...
    async def start_recording(self, call_id: str) -> dict: ...
    async def stop_recording(self, call_id: str) -> None: ...
    async def get_call_status(self, call_id: str) -> dict: ...
    async def initiate_voicemail_drop(self, to: str, from_: str, audio_url: str) -> dict: ...
    async def initiate_callback(
        self, agent_sip_uri: str, contact_number: str, webhook_url: str
    ) -> dict: ...
    async def get_active_calls(self) -> list[dict]: ...
    async def get_registrations(self) -> list[dict]: ...
    async def list_recent_calls(self, since: datetime) -> list[ProviderCallRecord]: ...
