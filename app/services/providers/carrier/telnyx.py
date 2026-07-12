from __future__ import annotations

import asyncio
import logging
from datetime import datetime

import httpx

from app.core.constants import TELNYX_API_BASE_URL
from app.services.providers.base import ProviderMessageRecord

logger = logging.getLogger(__name__)

_BASE_URL = TELNYX_API_BASE_URL

# NANP toll-free area-code prefixes (FCC-designated, fixed set).
_TOLL_FREE_PREFIXES: frozenset[str] = frozenset({"800", "833", "844", "855", "866", "877", "888"})

# Reconciliation reads Message Detail Records a page at a time. We ask for a
# single generous page and rely on the server-side time filter — the lookback
# window is short (default 60 min) so one page covers it.
_RECENT_MESSAGES_PAGE_SIZE = 250

# A number order can settle asynchronously; when its response omits the
# phone-number resource id we poll the owned-numbers listing briefly.
_PROVISION_LOOKUP_ATTEMPTS = 5
_PROVISION_LOOKUP_DELAY_S = 1.0

# Path Telnyx delivers inbound SMS (message.received) and delivery receipts
# (message.finalized) to. Configured on the messaging profile, not per-number.
_SMS_WEBHOOK_PATH = "/webhooks/telnyx/sms-inbound"

# A messaging-profile PATCH is accepted immediately but can take a moment to be
# reflected on read (and applied to routing); poll the profile until the new
# webhook URL comes back before treating the change as live.
_WEBHOOK_CONFIRM_ATTEMPTS = 10
_WEBHOOK_CONFIRM_DELAY_S = 1.0


class TelnyxCarrier:
    """CarrierProvider implementation backed by the Telnyx REST API."""

    def __init__(
        self,
        api_key: str,
        webhook_base_url: str,
        messaging_profile_id: str = "",
        sandbox: bool = False,
    ) -> None:
        self._webhook_base_url = webhook_base_url
        self._messaging_profile_id = messaging_profile_id
        self._sandbox = sandbox
        self._client = httpx.AsyncClient(
            base_url=_BASE_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
            timeout=30.0,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    # ------------------------------------------------------------------
    # DID management
    # ------------------------------------------------------------------

    async def search_numbers(
        self, area_code: str, count: int, country_code: str = "US"
    ) -> list[dict]:
        is_toll_free = country_code == "US" and area_code in _TOLL_FREE_PREFIXES
        if is_toll_free:
            params: dict = {
                "filter[number_type]": "toll_free",
                "filter[national_destination_code]": area_code,
                "filter[features][]": ["sms", "voice"],
                "filter[limit]": count,
            }
        else:
            params = {
                "filter[national_destination_code]": area_code,
                "filter[country_code]": country_code,
                "filter[features][]": ["sms", "voice"],
                "filter[limit]": count,
            }
        resp = await self._client.get("/available_phone_numbers", params=params)
        if resp.is_error:
            logger.error(
                "Telnyx search_numbers failed: area_code=%s country_code=%s status=%s body=%s",
                area_code,
                country_code,
                resp.status_code,
                resp.text,
            )
            resp.raise_for_status()
        data = resp.json().get("data", [])
        return [{"phone_number": item["phone_number"]} for item in data]

    async def provision_number(self, number: str, country_code: str = "US") -> dict:
        # Telnyx sells numbers through number orders; POST /v2/phone_numbers does
        # not exist (it 404s with error 10005). The order response carries the
        # phone-number resource id that release_number / enable_sms need.
        resp = await self._client.post(
            "/number_orders",
            json={"phone_numbers": [{"phone_number": number}]},
        )
        if resp.is_error:
            logger.error(
                "Telnyx provision_number failed: number=%s status=%s body=%s",
                number,
                resp.status_code,
                resp.text,
            )
            resp.raise_for_status()
        order = resp.json()["data"]
        entry: dict = next(
            (p for p in order.get("phone_numbers", []) if p.get("phone_number") == number),
            {},
        )
        provider_sid = entry.get("id") or await self._lookup_phone_number_id(number)
        return {
            "provider_sid": provider_sid,
            "phone_number": number,
        }

    async def _lookup_phone_number_id(self, number: str) -> str:
        """Resolve the phone-number resource id for a number we just ordered.

        A still-pending order can omit the resource id from its response; the
        owned-numbers listing has it once the purchase lands, so poll briefly.
        """
        for _ in range(_PROVISION_LOOKUP_ATTEMPTS):
            resp = await self._client.get("/phone_numbers", params={"filter[phone_number]": number})
            if resp.is_error:
                logger.error(
                    "Telnyx phone-number lookup failed: number=%s status=%s body=%s",
                    number,
                    resp.status_code,
                    resp.text,
                )
                resp.raise_for_status()
            data = resp.json().get("data", [])
            if data:
                return str(data[0]["id"])
            await asyncio.sleep(_PROVISION_LOOKUP_DELAY_S)
        raise RuntimeError(f"Telnyx number order for {number} settled without a phone-number id")

    async def release_number(self, provider_sid: str) -> None:
        resp = await self._client.delete(f"/phone_numbers/{provider_sid}")
        if resp.is_error:
            logger.error(
                "Telnyx release_number failed: sid=%s status=%s body=%s",
                provider_sid,
                resp.status_code,
                resp.text,
            )
            resp.raise_for_status()

    # ------------------------------------------------------------------
    # SMS
    # ------------------------------------------------------------------

    async def send_sms(self, from_: str, to: str, body: str) -> dict:
        resp = await self._client.post(
            "/messages",
            json={"from": from_, "to": to, "text": body},
        )
        if resp.is_error:
            logger.error(
                "Telnyx send_sms failed: from=%s to=%s status=%s body=%s",
                from_,
                to,
                resp.status_code,
                resp.text,
            )
            resp.raise_for_status()
        record = resp.json()["data"]
        return {"sid": record["id"], "status": record.get("to", [{}])[0].get("status", "queued")}

    async def enable_sms(self, provider_sid: str) -> None:
        # Telnyx enables SMS by assigning the number to a messaging profile;
        # PATCHing None would detach it (i.e. disable SMS).
        if not self._messaging_profile_id:
            raise ValueError("TELNYX_MESSAGING_PROFILE_ID is not configured; cannot enable SMS")
        resp = await self._client.patch(
            f"/phone_numbers/{provider_sid}",
            json={"messaging_profile_id": self._messaging_profile_id},
        )
        if resp.is_error:
            logger.error(
                "Telnyx enable_sms failed: sid=%s status=%s body=%s",
                provider_sid,
                resp.status_code,
                resp.text,
            )
            resp.raise_for_status()

    async def disable_sms(self, provider_sid: str) -> None:
        resp = await self._client.patch(
            f"/phone_numbers/{provider_sid}",
            json={"messaging_profile_id": None},
        )
        if resp.is_error:
            logger.error(
                "Telnyx disable_sms failed: sid=%s status=%s body=%s",
                provider_sid,
                resp.status_code,
                resp.text,
            )
            resp.raise_for_status()

    async def set_webhook_url(self, base_url: str | None = None, confirm: bool = True) -> str:
        """Point the account's messaging profile at Carameli's inbound-SMS webhook.

        Telnyx delivers inbound SMS and delivery receipts to the URL configured on
        the *messaging profile* (PATCH /v2/messaging_profiles/{id}), not per-number,
        so one call repoints every DID assigned to the profile. This lets
        ``scripts/start-ngrok.py`` update Telnyx whenever the tunnel URL changes
        instead of editing it by hand in the portal.

        ``base_url`` overrides the carrier's configured webhook base (the ngrok
        bootstrap passes the freshly-minted tunnel URL); it defaults to the base
        this carrier was constructed with.

        The PATCH is accepted instantly but takes a beat to apply, which races a
        test run that fires immediately after. When ``confirm`` is set (the
        default) this polls the profile until the new URL is reflected, so callers
        only proceed once the change is live. Returns the full webhook URL set.
        """
        if not self._messaging_profile_id:
            raise ValueError(
                "TELNYX_MESSAGING_PROFILE_ID is not configured; cannot set webhook URL"
            )
        base = (base_url or self._webhook_base_url).rstrip("/")
        webhook_url = f"{base}{_SMS_WEBHOOK_PATH}"
        resp = await self._client.patch(
            f"/messaging_profiles/{self._messaging_profile_id}",
            json={"webhook_url": webhook_url, "webhook_api_version": "2"},
        )
        if resp.is_error:
            logger.error(
                "Telnyx set_webhook_url failed: profile=%s url=%s status=%s body=%s",
                self._messaging_profile_id,
                webhook_url,
                resp.status_code,
                resp.text,
            )
            resp.raise_for_status()

        if confirm:
            await self._confirm_webhook_url(webhook_url)

        logger.info(
            "Telnyx messaging profile %s webhook set to %s",
            self._messaging_profile_id,
            webhook_url,
        )
        return webhook_url

    async def _confirm_webhook_url(self, expected_url: str) -> None:
        """Poll the messaging profile until its ``webhook_url`` reflects ``expected_url``.

        Guards the read-after-write race: a freshly-PATCHed profile can still
        report the old URL for a moment, and firing an SMS test in that window
        would hit the stale callback. Raises RuntimeError if it never settles.
        """
        for _ in range(_WEBHOOK_CONFIRM_ATTEMPTS):
            resp = await self._client.get(f"/messaging_profiles/{self._messaging_profile_id}")
            if resp.is_error:
                logger.error(
                    "Telnyx webhook confirm lookup failed: profile=%s status=%s body=%s",
                    self._messaging_profile_id,
                    resp.status_code,
                    resp.text,
                )
                resp.raise_for_status()
            if resp.json().get("data", {}).get("webhook_url") == expected_url:
                return
            await asyncio.sleep(_WEBHOOK_CONFIRM_DELAY_S)
        raise RuntimeError(
            f"Telnyx messaging profile {self._messaging_profile_id} did not reflect "
            f"webhook_url={expected_url} after {_WEBHOOK_CONFIRM_ATTEMPTS} attempts"
        )

    # ------------------------------------------------------------------
    # Area codes
    # ------------------------------------------------------------------

    async def get_available_area_codes(self, country: str, state: str | None = None) -> list[dict]:
        params: dict = {
            "filter[country_code]": country,
            "filter[features][]": ["sms", "voice"],
            "filter[limit]": 200,
        }
        if state:
            params["filter[administrative_area]"] = state

        resp = await self._client.get("/available_phone_numbers", params=params)
        if resp.is_error:
            logger.error(
                "Telnyx get_available_area_codes failed: country=%s state=%s status=%s body=%s",
                country,
                state,
                resp.status_code,
                resp.text,
            )
            resp.raise_for_status()

        data = resp.json().get("data", [])
        seen: set[str] = set()
        result: list[dict] = []
        for item in data:
            npa = item["phone_number"][2:5]  # strip +1, take next 3 digits
            # Exclude toll-free NPAs from local results; they're added explicitly below.
            if npa not in seen and npa not in _TOLL_FREE_PREFIXES:
                seen.add(npa)
                result.append({"area_code": npa, "country": country, "number_type": "local"})
        # For US, append the fixed set of FCC-designated toll-free prefixes.
        if country == "US":
            for prefix in sorted(_TOLL_FREE_PREFIXES):
                result.append({"area_code": prefix, "country": "US", "number_type": "toll-free"})
        return result

    # ------------------------------------------------------------------
    # Reconciliation
    # ------------------------------------------------------------------

    async def list_recent_messages(self, since: datetime) -> list[ProviderMessageRecord]:
        """Return recent messages from Telnyx's detail records since ``since``.

        Endpoint: GET /v2/detail_records filtered to messaging records. Telnyx
        supports a ``created_at`` time filter with a plain API key, so we push the
        ``since`` cutoff server-side and cap the response at one page
        (``_RECENT_MESSAGES_PAGE_SIZE``) — the reconciliation window is short.

        Consumed only through ``CarrierProvider.list_recent_messages`` by the
        reconciliation cron; ``message_sid`` matches the inbound-SMS webhook id.

        Sandbox mode (``TELNYX_SANDBOX=1``) has no real detail records, so return
        an empty list without calling the API.
        """
        if self._sandbox:
            logger.debug("Telnyx list_recent_messages: sandbox mode, returning no records")
            return []

        params: dict = {
            "filter[record_type]": "messaging",
            "filter[created_at][gte]": since.isoformat(),
            "page[size]": _RECENT_MESSAGES_PAGE_SIZE,
        }
        resp = await self._client.get("/detail_records", params=params)
        if resp.is_error:
            logger.error(
                "Telnyx list_recent_messages failed: since=%s status=%s body=%s",
                since.isoformat(),
                resp.status_code,
                resp.text,
            )
            resp.raise_for_status()
        data = resp.json().get("data", [])
        records: list[ProviderMessageRecord] = []
        for item in data:
            message_sid = item.get("id") or item.get("message_id")
            if not message_sid:
                continue
            records.append(
                ProviderMessageRecord(
                    message_sid=message_sid,
                    direction=item.get("direction"),
                    from_number=item.get("from"),
                    to_number=item.get("to"),
                    created_at=_parse_telnyx_datetime(item.get("created_at")),
                    status=item.get("status"),
                )
            )
        return records


def _parse_telnyx_datetime(value: object) -> datetime | None:
    """Parse a Telnyx ISO-8601 timestamp string into a datetime (None on failure)."""
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
