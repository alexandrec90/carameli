from __future__ import annotations

import logging
import secrets
from typing import Any

from twilio.base.exceptions import TwilioRestException
from twilio.rest import Client

logger = logging.getLogger(__name__)


class TwilioProvider:
    def __init__(self, client: Client, webhook_base_url: str) -> None:
        self.client = client
        self.webhook_base_url = webhook_base_url.rstrip("/")

    @staticmethod
    def _require_str(value: object | None, field_name: str) -> str:
        """Return a required string value from Twilio SDK objects."""
        if value is None:
            raise ValueError(f"Twilio response missing required field: {field_name}")
        return str(value)

    # ─── Phone Lines (DIDs) ───────────────────────────────────────────────

    async def purchase_did(
        self, area_code: str | None = None, phone_number: str | None = None
    ) -> dict[str, str]:
        """Purchase a DID from Twilio. Specify either area_code or phone_number."""
        try:
            kwargs: dict[str, Any] = {
                "voice_url": f"{self.webhook_base_url}/webhooks/twilio/voice",
                "sms_url": f"{self.webhook_base_url}/webhooks/twilio/sms",
                "status_callback": f"{self.webhook_base_url}/webhooks/twilio/call-status",
            }
            if phone_number:
                kwargs["phone_number"] = phone_number
            elif area_code:
                available = self.client.available_phone_numbers("US").local.list(
                    area_code=area_code, limit=1
                )
                if not available:
                    raise ValueError(f"No numbers available in area code {area_code}")
                kwargs["phone_number"] = available[0].phone_number
            else:
                raise ValueError("Must specify area_code or phone_number")

            result = self.client.incoming_phone_numbers.create(**kwargs)
            return {
                "sid": self._require_str(result.sid, "sid"),
                "phone_number": self._require_str(result.phone_number, "phone_number"),
            }
        except TwilioRestException as exc:
            logger.error("Twilio error purchasing DID: code=%s msg=%s", exc.code, exc.msg)
            raise

    async def release_did(self, twilio_sid: str) -> None:
        """Release a DID back to Twilio."""
        try:
            self.client.incoming_phone_numbers(twilio_sid).delete()
        except TwilioRestException as exc:
            logger.error("Twilio error releasing DID: code=%s msg=%s", exc.code, exc.msg)
            raise

    async def enable_sms(self, twilio_sid: str) -> None:
        """Enable SMS on a DID by setting the SMS webhook URL."""
        try:
            self.client.incoming_phone_numbers(twilio_sid).update(
                sms_url=f"{self.webhook_base_url}/webhooks/twilio/sms",
            )
        except TwilioRestException as exc:
            logger.error("Twilio error enabling SMS: code=%s msg=%s", exc.code, exc.msg)
            raise

    async def disable_sms(self, twilio_sid: str) -> None:
        """Disable SMS on a DID by clearing the SMS webhook URL."""
        try:
            self.client.incoming_phone_numbers(twilio_sid).update(sms_url="")
        except TwilioRestException as exc:
            logger.error("Twilio error disabling SMS: code=%s msg=%s", exc.code, exc.msg)
            raise

    async def update_recording(self, twilio_sid: str, enabled: bool) -> None:
        """Toggle call recording for a DID via voice_url flag."""
        try:
            suffix = "?record=true" if enabled else ""
            self.client.incoming_phone_numbers(twilio_sid).update(
                voice_url=f"{self.webhook_base_url}/webhooks/twilio/voice{suffix}"
            )
        except TwilioRestException as exc:
            logger.error(
                "Twilio error updating recording: code=%s msg=%s", exc.code, exc.msg
            )
            raise

    # ─── SMS ─────────────────────────────────────────────────────────────

    async def send_sms(
        self, from_number: str, to_number: str, body: str
    ) -> dict[str, str]:
        """Send an SMS via Twilio Messaging."""
        try:
            message = self.client.messages.create(
                to=to_number,
                from_=from_number,
                body=body,
            )
            return {
                "sid": self._require_str(message.sid, "sid"),
                "status": self._require_str(message.status, "status"),
            }
        except TwilioRestException as exc:
            logger.error("Twilio error sending SMS: code=%s msg=%s", exc.code, exc.msg)
            raise

    # ─── Calls ───────────────────────────────────────────────────────────

    async def initiate_voicemail_drop(
        self, to_number: str, from_number: str, audio_url: str
    ) -> dict[str, str]:
        """Initiate an outbound call with AMD for voicemail drop."""
        try:
            twiml = f"<Response><Play>{audio_url}</Play></Response>"
            call = self.client.calls.create(
                to=to_number,
                from_=from_number,
                twiml=twiml,
                machine_detection="Enable",
                status_callback=f"{self.webhook_base_url}/webhooks/twilio/call-status",
                status_callback_method="POST",
            )
            return {
                "call_sid": self._require_str(call.sid, "sid"),
                "status": self._require_str(call.status, "status"),
            }
        except TwilioRestException as exc:
            logger.error(
                "Twilio error initiating voicemail drop: code=%s msg=%s",
                exc.code,
                exc.msg,
            )
            raise

    # ─── Extensions (SIP) ────────────────────────────────────────────────

    async def ensure_sip_domain(self, customer_id: str) -> str:
        """Ensure a SIP Domain exists for this customer. Returns domain SID."""
        domain_name = f"vg-{customer_id[:8]}.sip.twilio.com"
        try:
            domains = self.client.sip.domains.list()
            for d in domains:
                if d.domain_name == domain_name:
                    return self._require_str(d.sid, "sid")
            domain = self.client.sip.domains.create(
                domain_name=domain_name,
                friendly_name=f"VoiceGateway {customer_id[:8]}",
                sip_registration=True,
            )
            return self._require_str(domain.sid, "sid")
        except TwilioRestException as exc:
            logger.error(
                "Twilio error creating SIP domain: code=%s msg=%s", exc.code, exc.msg
            )
            raise

    async def ensure_credential_list(self, customer_id: str) -> str:
        """Ensure a SIP Credential List exists for this customer. Returns list SID."""
        name = f"vg-{customer_id[:8]}"
        try:
            cred_lists = self.client.sip.credential_lists.list()
            for cl in cred_lists:
                if cl.friendly_name == name:
                    return self._require_str(cl.sid, "sid")
            cred_list = self.client.sip.credential_lists.create(friendly_name=name)
            return self._require_str(cred_list.sid, "sid")
        except TwilioRestException as exc:
            logger.error(
                "Twilio error creating credential list: code=%s msg=%s",
                exc.code,
                exc.msg,
            )
            raise

    async def create_sip_credential(
        self, credential_list_sid: str, username: str, password: str
    ) -> str:
        """Create a SIP credential. Returns credential SID."""
        try:
            cred = (
                self.client.sip.credential_lists(credential_list_sid)
                .credentials.create(username=username, password=password)
            )
            return self._require_str(cred.sid, "sid")
        except TwilioRestException as exc:
            logger.error(
                "Twilio error creating SIP credential: code=%s msg=%s",
                exc.code,
                exc.msg,
            )
            raise

    async def delete_sip_credential(
        self, credential_list_sid: str, credential_sid: str
    ) -> None:
        """Delete a SIP credential."""
        try:
            self.client.sip.credential_lists(credential_list_sid).credentials(
                credential_sid
            ).delete()
        except TwilioRestException as exc:
            logger.error(
                "Twilio error deleting SIP credential: code=%s msg=%s",
                exc.code,
                exc.msg,
            )
            raise

    # ─── Area Codes ──────────────────────────────────────────────────────

    async def get_available_area_codes(
        self, country: str = "US", state: str | None = None
    ) -> list[dict[str, str]]:
        """Return distinct area codes available from Twilio."""
        try:
            kwargs: dict[str, Any] = {"limit": 500}
            if state:
                kwargs["in_region"] = state

            numbers = self.client.available_phone_numbers(country).local.list(**kwargs)
            area_codes: dict[str, str] = {}
            for n in numbers:
                phone_number = n.phone_number
                if not phone_number:
                    continue
                ac = phone_number[2:5]  # E.164 +1NXX → strip +1
                if ac not in area_codes:
                    area_codes[ac] = self._require_str(n.iso_country, "iso_country")
            return [
                {"area_code": ac, "country": c} for ac, c in sorted(area_codes.items())
            ]
        except TwilioRestException as exc:
            logger.error(
                "Twilio error fetching area codes: code=%s msg=%s", exc.code, exc.msg
            )
            raise

    @staticmethod
    def generate_sip_password() -> str:
        """Generate a secure random SIP password."""
        return secrets.token_urlsafe(24)
