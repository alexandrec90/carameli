from __future__ import annotations

import logging

import httpx

logger = logging.getLogger(__name__)

_BASE_URL = "https://api.telnyx.com/v2"

# NANP toll-free area-code prefixes (FCC-designated, fixed set).
_TOLL_FREE_PREFIXES: frozenset[str] = frozenset({"800", "833", "844", "855", "866", "877", "888"})


class TelnyxCarrier:
    """CarrierProvider implementation backed by the Telnyx REST API."""

    def __init__(self, api_key: str, webhook_base_url: str) -> None:
        self._webhook_base_url = webhook_base_url
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
        resp = await self._client.post(
            "/phone_numbers",
            json={"phone_number": number},
        )
        if resp.is_error:
            logger.error(
                "Telnyx provision_number failed: number=%s status=%s body=%s",
                number,
                resp.status_code,
                resp.text,
            )
            resp.raise_for_status()
        record = resp.json()["data"]
        return {
            "provider_sid": record["id"],
            "phone_number": record["phone_number"],
        }

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
        resp = await self._client.patch(
            f"/phone_numbers/{provider_sid}",
            json={"messaging_profile_id": None},
        )
        # Telnyx re-enables SMS by assigning the number back to a messaging profile.
        # A 200 or 204 means the PATCH was accepted.
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
