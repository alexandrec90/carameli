from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, cast

import httpx

from app.services import callback_state
from app.services.providers.base import ProviderCallRecord, ProvisionedSipClient

logger = logging.getLogger(__name__)

# Reconciliation reads the RecentCalls report a page at a time. We ask for a
# single generous page and filter client-side by ``since`` rather than crawling
# pagination — the lookback window is short (default 60 min) so one page covers it.
_RECENT_CALLS_PAGE_SIZE = 500


def _parse_jambonz_datetime(value: Any) -> datetime | None:
    """Parse a Jambonz ISO-8601 timestamp string into a datetime (None on failure)."""
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


class JambonzEngine:
    """CallEngineProvider implementation backed by a self-hosted Jambonz instance."""

    def __init__(
        self,
        base_url: str,
        api_key: str,
        account_sid: str,
        webhook_base_url: str,
    ) -> None:
        self._account_sid = account_sid
        self._webhook_base_url = webhook_base_url.rstrip("/")
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/") + "/v1",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            timeout=30.0,
        )

    def _calls_url(self, call_id: str | None = None) -> str:
        base = f"/Accounts/{self._account_sid}/Calls"
        return f"{base}/{call_id}" if call_id else base

    def _account_url(self) -> str:
        return f"/Accounts/{self._account_sid}"

    async def aclose(self) -> None:
        await self._client.aclose()

    async def initiate_call(self, from_: str, to: str, webhook_url: str, **opts) -> dict:
        payload: dict[str, Any] = {
            "from": from_,
            "to": {"type": "phone", "number": to},
            "call_hook": {"url": webhook_url, "method": "POST"},
            "call_status_hook": {
                "url": f"{self._webhook_base_url}/webhooks/jambonz/call-status",
                "method": "POST",
            },
        }
        # Opaque application data echoed back on the call_hook (e.g. the agent SIP
        # URI to bridge to on answer). Jambonz returns it untouched in the webhook.
        tag = opts.get("tag")
        if tag is not None:
            payload["tag"] = tag
        resp = await self._client.post(self._calls_url(), json=payload)
        if resp.is_error:
            logger.error(
                "Jambonz initiate_call failed: from=%s to=%s status=%s body=%s",
                from_,
                to,
                resp.status_code,
                resp.text,
            )
            resp.raise_for_status()
        data = resp.json()
        call_sid = data.get("sid", data.get("call_sid", ""))
        logger.info("Jambonz call initiated: call_id=%s from=%s to=%s", call_sid, from_, to)
        return {"call_id": call_sid, "status": "queued"}

    async def hangup_call(self, call_id: str) -> None:
        resp = await self._client.delete(self._calls_url(call_id))
        if resp.is_error:
            logger.error(
                "Jambonz hangup_call failed: call_id=%s status=%s body=%s",
                call_id,
                resp.status_code,
                resp.text,
            )
            resp.raise_for_status()
        logger.info("Jambonz call hung up: call_id=%s", call_id)

    async def start_recording(self, call_id: str) -> dict:
        resp = await self._client.put(
            self._calls_url(call_id),
            json={"record": {"action": "startCallRecording"}},
        )
        if resp.is_error:
            logger.error(
                "Jambonz start_recording failed: call_id=%s status=%s body=%s",
                call_id,
                resp.status_code,
                resp.text,
            )
            resp.raise_for_status()
        logger.info("Jambonz recording started: call_id=%s", call_id)
        return {"call_id": call_id, "recording": "started"}

    async def stop_recording(self, call_id: str) -> None:
        resp = await self._client.put(
            self._calls_url(call_id),
            json={"record": {"action": "stopCallRecording"}},
        )
        if resp.is_error:
            logger.error(
                "Jambonz stop_recording failed: call_id=%s status=%s body=%s",
                call_id,
                resp.status_code,
                resp.text,
            )
            resp.raise_for_status()
        logger.info("Jambonz recording stopped: call_id=%s", call_id)

    async def get_call_status(self, call_id: str) -> dict:
        resp = await self._client.get(self._calls_url(call_id))
        if resp.is_error:
            logger.error(
                "Jambonz get_call_status failed: call_id=%s status=%s body=%s",
                call_id,
                resp.status_code,
                resp.text,
            )
            resp.raise_for_status()
        data = resp.json()
        return {
            "call_id": call_id,
            "status": data.get("call_status", data.get("status", "unknown")),
            "duration": data.get("duration"),
        }

    async def initiate_voicemail_drop(self, to: str, from_: str, audio_url: str) -> dict:
        """Initiate a call that plays an audio file (voicemail drop)."""
        payload = {
            "from": from_,
            "to": {"type": "phone", "number": to},
            "call_hook": {
                "url": f"{self._webhook_base_url}/webhooks/jambonz/voicemail-hook",
                "method": "POST",
            },
            "call_status_hook": {
                "url": f"{self._webhook_base_url}/webhooks/jambonz/call-status",
                "method": "POST",
            },
            "tag": {"audio_url": audio_url},
        }
        resp = await self._client.post(self._calls_url(), json=payload)
        if resp.is_error:
            logger.error(
                "Jambonz initiate_voicemail_drop failed: to=%s status=%s body=%s",
                to,
                resp.status_code,
                resp.text,
            )
            resp.raise_for_status()
        data = resp.json()
        call_sid = data.get("sid", data.get("call_sid", ""))
        logger.info("Jambonz voicemail drop initiated: call_id=%s to=%s", call_sid, to)
        return {"call_id": call_sid, "status": "queued"}

    async def play_audio_to_call(self, call_id: str, audio_url: str) -> dict:
        """Whisper one audio asset onto an already-active call leg."""
        resp = await self._client.put(
            self._calls_url(call_id),
            json={"whisper": {"verb": "play", "url": audio_url}},
        )
        if resp.is_error:
            logger.error(
                "Jambonz play_audio_to_call failed: call_id=%s status=%s body=%s",
                call_id,
                resp.status_code,
                resp.text,
            )
            resp.raise_for_status()
        logger.info("Jambonz voicemail audio injected: call_id=%s", call_id)
        return {"call_id": call_id, "status": "playing"}

    async def provision_sip_client(self, username: str, password: str) -> ProvisionedSipClient:
        """Create a static SIP client and return its id plus the account realm."""
        account_resp = await self._client.get(self._account_url())
        if account_resp.is_error:
            logger.error(
                "Jambonz account lookup failed: status=%s body=%s",
                account_resp.status_code,
                account_resp.text,
            )
            account_resp.raise_for_status()
        sip_realm = str(account_resp.json().get("sip_realm") or "")
        if not sip_realm:
            raise RuntimeError("Jambonz account has no SIP realm configured")

        resp = await self._client.post(
            "/Clients",
            json={
                "account_sid": self._account_sid,
                "username": username,
                "password": password,
                "is_active": 1,
            },
        )
        if resp.is_error:
            logger.error(
                "Jambonz SIP client create failed: username=%s status=%s body=%s",
                username,
                resp.status_code,
                resp.text,
            )
            resp.raise_for_status()
        client_sid = str(resp.json().get("sid") or "")
        if not client_sid:
            raise RuntimeError("Jambonz SIP client response did not include sid")
        logger.info("Jambonz SIP client created: client_sid=%s username=%s", client_sid, username)
        return ProvisionedSipClient(client_sid=client_sid, sip_realm=sip_realm)

    async def deprovision_sip_client(self, client_sid: str) -> None:
        resp = await self._client.delete(f"/Clients/{client_sid}")
        if resp.is_error and resp.status_code != 404:
            logger.error(
                "Jambonz SIP client delete failed: client_sid=%s status=%s body=%s",
                client_sid,
                resp.status_code,
                resp.text,
            )
            resp.raise_for_status()
        logger.info("Jambonz SIP client deleted: client_sid=%s", client_sid)

    async def get_active_calls(self) -> list[dict]:
        """Return all active calls for this Jambonz account.

        Each item includes at minimum: call_sid, call_status, sip_user (the SIP
        username of the agent leg, if present), direction, from, to.

        Endpoint: GET /v1/Accounts/{account_sid}/Calls
        Verify the exact response shape against your Jambonz instance — the
        ``sip_user`` field is populated only for SIP-terminated legs.
        """
        resp = await self._client.get(self._calls_url())
        if resp.is_error:
            logger.error(
                "Jambonz get_active_calls failed: status=%s body=%s",
                resp.status_code,
                resp.text,
            )
            resp.raise_for_status()
        data = resp.json()
        # Jambonz may return a list directly or {"calls": [...]}
        if isinstance(data, list):
            return cast(list[dict[Any, Any]], data)
        return cast(list[dict[Any, Any]], data.get("calls", data.get("data", [])))

    async def list_recent_calls(self, since: datetime) -> list[ProviderCallRecord]:
        """Return recent calls from the Jambonz RecentCalls report since ``since``.

        Endpoint: GET /v1/Accounts/{account_sid}/RecentCalls (paginated, newest
        first). Jambonz supports a ``days`` filter but not a precise timestamp
        cutoff, so we fetch one large page and filter client-side by
        ``attempted_at`` — the reconciliation lookback window is short enough that
        a single page covers it (see ``_RECENT_CALLS_PAGE_SIZE``).

        Consumed only through ``CallEngineProvider.list_recent_calls`` by the
        reconciliation cron; ``call_sid`` matches the call-status webhook's sid.
        """
        url = f"/Accounts/{self._account_sid}/RecentCalls"
        resp = await self._client.get(url, params={"page": 1, "count": _RECENT_CALLS_PAGE_SIZE})
        if resp.is_error:
            logger.error(
                "Jambonz list_recent_calls failed: status=%s body=%s",
                resp.status_code,
                resp.text,
            )
            resp.raise_for_status()
        data = resp.json()
        rows = cast(
            list[dict[str, Any]],
            data if isinstance(data, list) else data.get("data", data.get("calls", [])),
        )
        records: list[ProviderCallRecord] = []
        for row in rows:
            call_sid = row.get("call_sid") or row.get("sid")
            if not call_sid:
                continue
            started_at = _parse_jambonz_datetime(
                row.get("attempted_at") or row.get("answered_at") or row.get("started_at")
            )
            # Drop rows older than the reconciliation window (report is newest-first,
            # but be defensive and filter every row).
            if started_at is not None and started_at < since:
                continue
            records.append(
                ProviderCallRecord(
                    call_sid=call_sid,
                    direction=row.get("direction"),
                    from_number=row.get("from"),
                    to_number=row.get("to"),
                    started_at=started_at,
                    status=row.get("call_status") or row.get("status"),
                )
            )
        return records

    async def get_registrations(self) -> list[dict]:
        """Return SIP registrations for this Jambonz account.

        Each item includes at minimum: sipUser (the SIP username).

        Endpoint: GET /v1/Accounts/{account_sid}/registrations
        NOTE: verify this path against your Jambonz version; some releases use
        GET /v1/registrations (global) or a different casing.
        """
        url = f"/Accounts/{self._account_sid}/registrations"
        resp = await self._client.get(url)
        if resp.is_error:
            logger.error(
                "Jambonz get_registrations failed: status=%s body=%s",
                resp.status_code,
                resp.text,
            )
            resp.raise_for_status()
        data = resp.json()
        if isinstance(data, list):
            return cast(list[dict[Any, Any]], data)
        return cast(list[dict[Any, Any]], data.get("registrations", data.get("data", [])))

    async def initiate_callback(
        self, agent_sip_uri: str, contact_number: str, webhook_url: str
    ) -> dict:
        """Initiate a two-leg callback: call the agent first, then bridge to the contact.

        When Jambonz fires the call-hook for the agent leg, the caller should POST
        to webhook_url (i.e. /webhooks/jambonz/callback-answered) which looks up
        the stored contact_number and returns a dial verb.
        """
        payload = {
            "from": contact_number,
            "to": {"type": "sip", "sipUri": agent_sip_uri},
            "call_hook": {"url": webhook_url, "method": "POST"},
            "call_status_hook": {
                "url": f"{self._webhook_base_url}/webhooks/jambonz/call-status",
                "method": "POST",
            },
        }
        resp = await self._client.post(self._calls_url(), json=payload)
        if resp.is_error:
            logger.error(
                "Jambonz initiate_callback failed: agent=%s contact=%s status=%s body=%s",
                agent_sip_uri,
                contact_number,
                resp.status_code,
                resp.text,
            )
            resp.raise_for_status()
        data = resp.json()
        call_sid = data.get("sid", data.get("call_sid", ""))
        await callback_state.set_pending_callback(call_sid, contact_number)
        logger.info(
            "Jambonz callback initiated: call_sid=%s agent=%s contact=%s",
            call_sid,
            agent_sip_uri,
            contact_number,
        )
        return {"call_id": call_sid, "status": "queued"}
