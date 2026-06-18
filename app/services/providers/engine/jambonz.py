from __future__ import annotations

import logging
from typing import Any, cast

import httpx

from app.services.callback_state import pending_callbacks, pending_callbacks_lock

logger = logging.getLogger(__name__)


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
        async with pending_callbacks_lock:
            pending_callbacks[call_sid] = contact_number
        logger.info(
            "Jambonz callback initiated: call_sid=%s agent=%s contact=%s",
            call_sid,
            agent_sip_uri,
            contact_number,
        )
        return {"call_id": call_sid, "status": "queued"}
