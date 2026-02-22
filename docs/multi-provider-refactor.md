# Multi-Provider VoIP Refactor — Implementation Plan

<!-- markdownlint-disable MD031 MD013 -->

**Status:** Ready to implement
**PoC Provider:** SignalWire
**Scope:** Provider abstraction layer + SignalWire as the second provider + outbound-only failover
**Author:** Architecture design session 2026-02-21

---

## Why SignalWire First

SignalWire was founded by ex-Twilio engineers and was designed from day one to be
Twilio-compatible:

- The `signalwire` Python package wraps the Twilio SDK — **same method signatures**
  for phone number management, SMS, and outbound calls.
- Webhook payloads use **identical field names** (`CallSid`, `CallStatus`,
  `CallDuration`, `RecordingUrl`, `Direction`, etc.) — so `CallEventRepo` needs
  zero changes.
- "LaML" is SignalWire's name for TwiML. The XML format is identical — the same
  `<Response><Play>`, `<Response><Say>`, etc. works unchanged.
- Signature validation uses the **same HMAC-SHA1 algorithm** as Twilio. The
  existing `RequestValidator` from `twilio.request_validator` can validate
  SignalWire webhooks; only the header name differs (`X-SignalWire-Signature`
  vs. `X-Twilio-Signature`).
- SIP concepts (domains, credential lists) are the same; domain names follow
  the pattern `{name}.sip.signalwire.com`.

This means `SignalWireProvider` will share ~85% of its logic with `TwilioProvider`,
making it the smallest-delta proof of concept before tackling more different
providers (Telnyx, Vonage).

---

## What Is Out of Scope (Future Phases)

- Telnyx provider (TeXML-compatible but different SDK and SIP format)
- Vonage provider (NCCO JSON — completely different call control, do last)
- Inbound call failover (requires pre-provisioned numbers on a backup provider;
  can't be done automatically at runtime)
- Per-customer provider selection (current code already stores per-customer Twilio
  credentials in the DB but the routes use the **global** `app.state.twilio` client
  — this discrepancy is pre-existing and intentionally left for a future pass)
- Provider health-check dashboard or UI
- Automatic cost-based routing
- Renaming `twilio_sid` → `provider_sid` in DB (deferred; the column will store
  SignalWire SIDs just as well since both use the same `PN...` / `CA...` SID
  format convention)

---

## Current Code Patterns to Preserve

These patterns are used throughout the existing routes. The refactor must not
break them:

1. **Provider access:** `provider: TwilioProvider = request.app.state.twilio`
   → After refactor: `provider: BaseVoIPProvider = request.app.state.provider`
   (keep using `app.state`; just change the key name and type hint)

2. **Dict return values from provider:**
   `result["sid"]`, `result["phone_number"]`, `result["status"]`, `result["call_sid"]`
   → These stay as dicts in the interim to minimise route churn. The base
   interface will use typed dataclasses, but TwilioProvider keeps returning dicts
   for now and the refactor updates the base interface to match. See Step 3 for
   the exact decision.

3. **Exception handling in routes:**
   Routes catch `TwilioRestException` directly.
   → After refactor, routes catch a provider-agnostic `VoIPProviderError` instead.

4. **`app.state.twilio` is a raw `TwilioProvider`, not a `Client`:**
   The existing code stores `TwilioProvider` (service wrapper) on `app.state.twilio`,
   not the raw `twilio.rest.Client`. `main.py` currently stores the `Client` object,
   not the `TwilioProvider` — routes instantiate `TwilioProvider` via `request.app.state.twilio`
   type-hint cast but that cast is wrong. Fix this as part of the refactor.

   **Actual current `main.py`:**
   ```python
   app.state.twilio = Client(settings.twilio_account_sid, settings.twilio_auth_token)
   ```
   Routes then do:
   ```python
   provider: TwilioProvider = request.app.state.twilio  # type: ignore — this is actually the Client
   ```
   This is a latent bug. The refactor fixes it by storing the correct type.

---

## File Change Inventory

```text
NEW  app/services/base_provider.py
NEW  app/services/signalwire_provider.py
NEW  app/services/provider_factory.py
NEW  app/api/webhooks/signalwire_webhooks.py
MOD  app/services/twilio_provider.py        — implement BaseVoIPProvider, raise VoIPProviderError
MOD  app/models/customer.py                 — add provider + SW credential fields
MOD  app/models/phone_line.py               — add provider column
MOD  app/models/extension.py               — add provider column
MOD  app/schemas/customers.py              — add provider fields to Create/Response
MOD  app/core/config.py                    — add SignalWire settings
MOD  app/main.py                           — store ProviderFactory on app.state
MOD  app/api/vsapi/phone_lines.py          — use BaseVoIPProvider, catch VoIPProviderError
MOD  app/api/vsapi/sms.py                  — use BaseVoIPProvider + failover
MOD  app/api/vsapi/voicemail_drop.py       — use BaseVoIPProvider + failover
MOD  app/api/vsapi/extensions.py           — use BaseVoIPProvider
MOD  app/api/vsapi/area_codes.py           — use BaseVoIPProvider
MOD  app/api/webhooks/call_status.py       — rename Twilio-specific header constant
NEW  alembic/versions/XXXX_add_provider_fields.py
MOD  requirements.txt                      — add signalwire>=1.4
MOD  .env.example                          — add SignalWire vars
```

---

## Step 1 — Requirements

Add to `requirements.txt`:
```text
signalwire>=1.4
```

The `signalwire` package re-exports and wraps `twilio` — both can coexist.

---

## Step 2 — Config Changes

**File:** `app/core/config.py`

Add to the `Settings` class:
```python
# SignalWire (global / fallback)
signalwire_project_id: str = ""
signalwire_api_token: str = ""
signalwire_space_url: str = ""  # e.g. "myspace.signalwire.com"

# Comma-separated provider priority for outbound-only failover.
# First entry is primary; subsequent entries are tried in order.
# Example: "twilio,signalwire"  or  "signalwire,twilio"
provider_failover_order: str = "twilio"
```

**File:** `.env.example`

Add:
```text
SIGNALWIRE_PROJECT_ID=
SIGNALWIRE_API_TOKEN=
SIGNALWIRE_SPACE_URL=
PROVIDER_FAILOVER_ORDER=twilio,signalwire
```

---

## Step 3 — Canonical Error Type

**File:** `app/services/base_provider.py` (new)

Define a single exception class. All provider implementations catch their
native SDK exception and re-raise as `VoIPProviderError`. Routes catch only
`VoIPProviderError`.

```python
from __future__ import annotations


class VoIPProviderError(Exception):
    """Raised by any BaseVoIPProvider when the upstream provider returns an error."""

    def __init__(self, message: str, code: int | None = None) -> None:
        super().__init__(message)
        self.code = code        # provider-native error code (Twilio: exc.code; SW: same)
        self.message = message
```

---

## Step 4 — Base Interface

Continue in `app/services/base_provider.py`. Add after `VoIPProviderError`:

```python
import logging
import secrets
from abc import ABC, abstractmethod
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class DidResult:
    sid: str
    phone_number: str  # E.164


@dataclass
class SmsResult:
    sid: str
    status: str


@dataclass
class CallResult:
    call_sid: str
    status: str


@dataclass
class AreaCode:
    area_code: str
    country: str


class BaseVoIPProvider(ABC):
    """
    Abstract interface every VoIP provider must implement.

    All methods are async.  On error, implementations must raise VoIPProviderError
    (never the SDK-native exception type).  Routes catch only VoIPProviderError.
    """

    # ── Phone numbers (DIDs) ─────────────────────────────────────────────────

    @abstractmethod
    async def purchase_did(
        self,
        area_code: str | None = None,
        phone_number: str | None = None,
    ) -> DidResult: ...

    @abstractmethod
    async def release_did(self, provider_sid: str) -> None: ...

    @abstractmethod
    async def enable_sms(self, provider_sid: str) -> None: ...

    @abstractmethod
    async def disable_sms(self, provider_sid: str) -> None: ...

    @abstractmethod
    async def update_recording(self, provider_sid: str, enabled: bool) -> None: ...

    # ── Messaging ─────────────────────────────────────────────────────────────

    @abstractmethod
    async def send_sms(
        self, from_number: str, to_number: str, body: str
    ) -> SmsResult: ...

    # ── Calls ─────────────────────────────────────────────────────────────────

    @abstractmethod
    async def initiate_voicemail_drop(
        self, to_number: str, from_number: str, audio_url: str
    ) -> CallResult: ...

    # ── SIP / Extensions ──────────────────────────────────────────────────────

    @abstractmethod
    async def ensure_sip_domain(self, customer_id: str) -> str:
        """Return the provider SID of the SIP domain (create if missing)."""
        ...

    @abstractmethod
    async def ensure_credential_list(self, customer_id: str) -> str:
        """Return the provider SID of the SIP credential list (create if missing)."""
        ...

    @abstractmethod
    async def create_sip_credential(
        self, list_sid: str, username: str, password: str
    ) -> str:
        """Return the credential SID."""
        ...

    @abstractmethod
    async def delete_sip_credential(
        self, list_sid: str, credential_sid: str
    ) -> None: ...

    # ── Utilities ──────────────────────────────────────────────────────────────

    @abstractmethod
    async def get_available_area_codes(
        self, country: str = "US", state: str | None = None
    ) -> list[AreaCode]: ...

    @staticmethod
    def generate_sip_password() -> str:
        return secrets.token_urlsafe(24)
```

---

## Step 5 — Refactor TwilioProvider

**File:** `app/services/twilio_provider.py`

### Changes required

1. **Imports:** Add `from app.services.base_provider import (AreaCode, BaseVoIPProvider,
   CallResult, DidResult, SmsResult, VoIPProviderError)`

2. **Class declaration:** Change to `class TwilioProvider(BaseVoIPProvider):`

3. **Return types:** Change every method to return the typed dataclass instead of `dict`:
   - `purchase_did` → `DidResult`
   - `send_sms` → `SmsResult`
   - `initiate_voicemail_drop` → `CallResult`
   - `get_available_area_codes` → `list[AreaCode]`
   - SIP methods already return `str` or `None` — no change.

4. **Exception handling:** In every `except TwilioRestException as exc:` block,
   replace `raise` with:
   ```python
   raise VoIPProviderError(exc.msg, code=exc.code) from exc
   ```

5. **Return statements:** Update each method's return to use the dataclass:
   ```python
   # purchase_did — was:
   return {"sid": ..., "phone_number": ...}
   # becomes:
   return DidResult(sid=..., phone_number=...)

   # send_sms — was:
   return {"sid": ..., "status": ...}
   # becomes:
   return SmsResult(sid=..., status=...)

   # initiate_voicemail_drop — was:
   return {"call_sid": ..., "status": ...}
   # becomes:
   return CallResult(call_sid=..., status=...)

   # get_available_area_codes — was:
   return [{"area_code": ac, "country": c} ...]
   # becomes:
   return [AreaCode(area_code=ac, country=c) ...]
   ```

6. **Remove `generate_sip_password`** from `TwilioProvider` — it now lives on
   `BaseVoIPProvider` as a static method. Delete the duplicate.

---

## Step 6 — SignalWire Provider

**File:** `app/services/signalwire_provider.py` (new)

> **Agent note before writing this file:**
> Run `pip show signalwire` to confirm the installed version and check whether
> the exception class is `signalwire.exceptions.SignalWireException` or whether
> it re-exports `TwilioRestException`. The code below assumes the latter (most
> common). Adjust the import if wrong.
> Also verify the SIP domain name format in SignalWire docs — the pattern
> `vg-{id}.sip.signalwire.com` is assumed but must be confirmed.

```python
from __future__ import annotations

import logging
from typing import Any

from signalwire.rest import Client as SignalWireClient
from twilio.base.exceptions import TwilioRestException  # SW SDK re-exports this

from app.services.base_provider import (
    AreaCode,
    BaseVoIPProvider,
    CallResult,
    DidResult,
    SmsResult,
    VoIPProviderError,
)

logger = logging.getLogger(__name__)


class SignalWireProvider(BaseVoIPProvider):
    """
    VoIP provider backed by the SignalWire Compatibility API.
    The SignalWire Python SDK mirrors the Twilio SDK — most operations are
    drop-in compatible.
    """

    def __init__(
        self,
        project_id: str,
        api_token: str,
        space_url: str,
        webhook_base_url: str,
    ) -> None:
        # signalwire.rest.Client(project_id, api_token, signalwire_space_url=space_url)
        self._client = SignalWireClient(
            project_id, api_token, signalwire_space_url=space_url
        )
        self._webhook_base_url = webhook_base_url.rstrip("/")

    @staticmethod
    def _require_str(value: object | None, field_name: str) -> str:
        if value is None:
            raise ValueError(f"SignalWire response missing required field: {field_name}")
        return str(value)

    # ── Phone numbers (DIDs) ─────────────────────────────────────────────────

    async def purchase_did(
        self,
        area_code: str | None = None,
        phone_number: str | None = None,
    ) -> DidResult:
        try:
            kwargs: dict[str, Any] = {
                "voice_url": f"{self._webhook_base_url}/webhooks/signalwire/voice",
                "sms_url": f"{self._webhook_base_url}/webhooks/signalwire/sms",
                "status_callback": f"{self._webhook_base_url}/webhooks/signalwire/call-status",
            }
            if phone_number:
                kwargs["phone_number"] = phone_number
            elif area_code:
                available = self._client.available_phone_numbers("US").local.list(
                    area_code=area_code, limit=1
                )
                if not available:
                    raise ValueError(f"No numbers available in area code {area_code}")
                kwargs["phone_number"] = available[0].phone_number
            else:
                raise ValueError("Must specify area_code or phone_number")

            result = self._client.incoming_phone_numbers.create(**kwargs)
            return DidResult(
                sid=self._require_str(result.sid, "sid"),
                phone_number=self._require_str(result.phone_number, "phone_number"),
            )
        except TwilioRestException as exc:
            logger.error(
                "SignalWire error purchasing DID: code=%s msg=%s", exc.code, exc.msg
            )
            raise VoIPProviderError(exc.msg, code=exc.code) from exc

    async def release_did(self, provider_sid: str) -> None:
        try:
            self._client.incoming_phone_numbers(provider_sid).delete()
        except TwilioRestException as exc:
            logger.error(
                "SignalWire error releasing DID: code=%s msg=%s", exc.code, exc.msg
            )
            raise VoIPProviderError(exc.msg, code=exc.code) from exc

    async def enable_sms(self, provider_sid: str) -> None:
        try:
            self._client.incoming_phone_numbers(provider_sid).update(
                sms_url=f"{self._webhook_base_url}/webhooks/signalwire/sms"
            )
        except TwilioRestException as exc:
            logger.error(
                "SignalWire error enabling SMS: code=%s msg=%s", exc.code, exc.msg
            )
            raise VoIPProviderError(exc.msg, code=exc.code) from exc

    async def disable_sms(self, provider_sid: str) -> None:
        try:
            self._client.incoming_phone_numbers(provider_sid).update(sms_url="")
        except TwilioRestException as exc:
            logger.error(
                "SignalWire error disabling SMS: code=%s msg=%s", exc.code, exc.msg
            )
            raise VoIPProviderError(exc.msg, code=exc.code) from exc

    async def update_recording(self, provider_sid: str, enabled: bool) -> None:
        try:
            suffix = "?record=true" if enabled else ""
            self._client.incoming_phone_numbers(provider_sid).update(
                voice_url=f"{self._webhook_base_url}/webhooks/signalwire/voice{suffix}"
            )
        except TwilioRestException as exc:
            logger.error(
                "SignalWire error updating recording: code=%s msg=%s", exc.code, exc.msg
            )
            raise VoIPProviderError(exc.msg, code=exc.code) from exc

    # ── SMS ───────────────────────────────────────────────────────────────────

    async def send_sms(
        self, from_number: str, to_number: str, body: str
    ) -> SmsResult:
        try:
            msg = self._client.messages.create(
                to=to_number, from_=from_number, body=body
            )
            return SmsResult(
                sid=self._require_str(msg.sid, "sid"),
                status=self._require_str(msg.status, "status"),
            )
        except TwilioRestException as exc:
            logger.error(
                "SignalWire error sending SMS: code=%s msg=%s", exc.code, exc.msg
            )
            raise VoIPProviderError(exc.msg, code=exc.code) from exc

    # ── Calls ─────────────────────────────────────────────────────────────────

    async def initiate_voicemail_drop(
        self, to_number: str, from_number: str, audio_url: str
    ) -> CallResult:
        try:
            twiml = f"<Response><Play>{audio_url}</Play></Response>"
            call = self._client.calls.create(
                to=to_number,
                from_=from_number,
                twiml=twiml,
                machine_detection="Enable",
                status_callback=f"{self._webhook_base_url}/webhooks/signalwire/call-status",
                status_callback_method="POST",
            )
            return CallResult(
                call_sid=self._require_str(call.sid, "sid"),
                status=self._require_str(call.status, "status"),
            )
        except TwilioRestException as exc:
            logger.error(
                "SignalWire error initiating voicemail drop: code=%s msg=%s",
                exc.code,
                exc.msg,
            )
            raise VoIPProviderError(exc.msg, code=exc.code) from exc

    # ── SIP / Extensions ──────────────────────────────────────────────────────
    # AGENT: Verify SignalWire SIP domain format in SW docs before implementing.
    # Assumed pattern: vg-{customer_id[:8]}.sip.signalwire.com

    async def ensure_sip_domain(self, customer_id: str) -> str:
        domain_name = f"vg-{customer_id[:8]}.sip.signalwire.com"  # VERIFY
        try:
            domains = self._client.sip.domains.list()
            for d in domains:
                if d.domain_name == domain_name:
                    return self._require_str(d.sid, "sid")
            domain = self._client.sip.domains.create(
                domain_name=domain_name,
                friendly_name=f"VoiceGateway {customer_id[:8]}",
                sip_registration=True,
            )
            return self._require_str(domain.sid, "sid")
        except TwilioRestException as exc:
            logger.error(
                "SignalWire error creating SIP domain: code=%s msg=%s",
                exc.code,
                exc.msg,
            )
            raise VoIPProviderError(exc.msg, code=exc.code) from exc

    async def ensure_credential_list(self, customer_id: str) -> str:
        name = f"vg-{customer_id[:8]}"
        try:
            for cl in self._client.sip.credential_lists.list():
                if cl.friendly_name == name:
                    return self._require_str(cl.sid, "sid")
            cred_list = self._client.sip.credential_lists.create(friendly_name=name)
            return self._require_str(cred_list.sid, "sid")
        except TwilioRestException as exc:
            logger.error(
                "SignalWire error creating credential list: code=%s msg=%s",
                exc.code,
                exc.msg,
            )
            raise VoIPProviderError(exc.msg, code=exc.code) from exc

    async def create_sip_credential(
        self, list_sid: str, username: str, password: str
    ) -> str:
        try:
            cred = (
                self._client.sip.credential_lists(list_sid)
                .credentials.create(username=username, password=password)
            )
            return self._require_str(cred.sid, "sid")
        except TwilioRestException as exc:
            logger.error(
                "SignalWire error creating SIP credential: code=%s msg=%s",
                exc.code,
                exc.msg,
            )
            raise VoIPProviderError(exc.msg, code=exc.code) from exc

    async def delete_sip_credential(
        self, list_sid: str, credential_sid: str
    ) -> None:
        try:
            self._client.sip.credential_lists(list_sid).credentials(
                credential_sid
            ).delete()
        except TwilioRestException as exc:
            logger.error(
                "SignalWire error deleting SIP credential: code=%s msg=%s",
                exc.code,
                exc.msg,
            )
            raise VoIPProviderError(exc.msg, code=exc.code) from exc

    # ── Area codes ────────────────────────────────────────────────────────────

    async def get_available_area_codes(
        self, country: str = "US", state: str | None = None
    ) -> list[AreaCode]:
        try:
            kwargs: dict[str, Any] = {"limit": 500}
            if state:
                kwargs["in_region"] = state
            numbers = self._client.available_phone_numbers(country).local.list(**kwargs)
            seen: dict[str, str] = {}
            for n in numbers:
                phone_number = n.phone_number
                if not phone_number:
                    continue
                ac = phone_number[2:5]
                if ac not in seen:
                    seen[ac] = self._require_str(n.iso_country, "iso_country")
            return [
                AreaCode(area_code=ac, country=c)
                for ac, c in sorted(seen.items())
            ]
        except TwilioRestException as exc:
            logger.error(
                "SignalWire error fetching area codes: code=%s msg=%s",
                exc.code,
                exc.msg,
            )
            raise VoIPProviderError(exc.msg, code=exc.code) from exc
```

---

## Step 7 — Provider Factory + Failover Router

**File:** `app/services/provider_factory.py` (new)

```python
from __future__ import annotations

import logging
from collections.abc import Sequence

from twilio.rest import Client as TwilioClient

from app.core.config import settings
from app.services.base_provider import BaseVoIPProvider, CallResult, SmsResult, VoIPProviderError
from app.services.twilio_provider import TwilioProvider
from app.services.signalwire_provider import SignalWireProvider

logger = logging.getLogger(__name__)


class ProviderFactory:
    """
    Builds provider instances and provides outbound-failover helpers.

    Stored as app.state.provider_factory at startup.
    All methods that instantiate providers use global config credentials
    (per-customer credential routing is out of scope for this PoC).
    """

    def __init__(self) -> None:
        # Pre-build configured providers; skip if credentials are absent.
        self._providers: dict[str, BaseVoIPProvider] = {}

        if settings.twilio_account_sid and settings.twilio_auth_token:
            self._providers["twilio"] = TwilioProvider(
                client=TwilioClient(
                    settings.twilio_account_sid, settings.twilio_auth_token
                ),
                webhook_base_url=settings.twilio_webhook_base_url,
            )
            logger.info("ProviderFactory: Twilio provider initialised")

        if (
            settings.signalwire_project_id
            and settings.signalwire_api_token
            and settings.signalwire_space_url
        ):
            from app.services.signalwire_provider import SignalWireProvider

            self._providers["signalwire"] = SignalWireProvider(
                project_id=settings.signalwire_project_id,
                api_token=settings.signalwire_api_token,
                space_url=settings.signalwire_space_url,
                webhook_base_url=settings.twilio_webhook_base_url,
            )
            logger.info("ProviderFactory: SignalWire provider initialised")

        if not self._providers:
            logger.warning(
                "ProviderFactory: no providers configured — all VoIP calls will fail"
            )

    def get(self, provider_name: str) -> BaseVoIPProvider:
        """Return a named provider. Raises KeyError if not configured."""
        try:
            return self._providers[provider_name]
        except KeyError:
            raise KeyError(
                "Provider '%s' is not configured. "
                "Check env vars for that provider." % provider_name
            )

    def primary(self) -> BaseVoIPProvider:
        """Return the first provider in PROVIDER_FAILOVER_ORDER."""
        order = [p.strip() for p in settings.provider_failover_order.split(",")]
        for name in order:
            if name in self._providers:
                return self._providers[name]
        raise RuntimeError(
            "No configured provider found in PROVIDER_FAILOVER_ORDER=%s"
            % settings.provider_failover_order
        )

    def failover_sequence(self) -> list[BaseVoIPProvider]:
        """Return all configured providers in PROVIDER_FAILOVER_ORDER priority."""
        order = [p.strip() for p in settings.provider_failover_order.split(",")]
        return [self._providers[name] for name in order if name in self._providers]

    # ── Failover helpers ─────────────────────────────────────────────────────

    async def failover_send_sms(
        self,
        from_number: str,
        to_number: str,
        body: str,
    ) -> SmsResult:
        """Try each provider in failover order; return first success."""
        providers = self.failover_sequence()
        last_exc: Exception | None = None
        for provider in providers:
            try:
                return await provider.send_sms(from_number, to_number, body)
            except VoIPProviderError as exc:
                logger.warning(
                    "SMS failed on %s (code=%s), trying next provider",
                    type(provider).__name__,
                    exc.code,
                )
                last_exc = exc
        raise VoIPProviderError("All providers failed for SMS send") from last_exc

    async def failover_call(
        self,
        to_number: str,
        from_number: str,
        audio_url: str,
    ) -> CallResult:
        """Try each provider in failover order; return first success."""
        providers = self.failover_sequence()
        last_exc: Exception | None = None
        for provider in providers:
            try:
                return await provider.initiate_voicemail_drop(
                    to_number, from_number, audio_url
                )
            except VoIPProviderError as exc:
                logger.warning(
                    "Voicemail drop failed on %s (code=%s), trying next provider",
                    type(provider).__name__,
                    exc.code,
                )
                last_exc = exc
        raise VoIPProviderError("All providers failed for voicemail drop") from last_exc
```

---

## Step 8 — `app/main.py` Changes

Replace the Twilio client setup with the provider factory:

```python
# Remove:
from twilio.rest import Client
# ...
app.state.twilio = Client(settings.twilio_account_sid, settings.twilio_auth_token)

# Add:
from app.services.provider_factory import ProviderFactory
# ...
app.state.provider_factory = ProviderFactory()
```

Register the new SignalWire webhook router (add alongside the existing Twilio router):

```python
from app.api.webhooks.signalwire_webhooks import router as signalwire_webhooks_router
# ...
app.include_router(signalwire_webhooks_router)
```

---

## Step 9 — SignalWire Webhook Handler

**File:** `app/api/webhooks/signalwire_webhooks.py` (new)

```python
from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session
from app.repositories.call_event_repo import CallEventRepo

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/webhooks/signalwire", tags=["webhooks-signalwire"])


def _validate_signalwire_signature(request: Request, form_data: dict) -> None:
    """
    SignalWire uses the same HMAC-SHA1 algorithm as Twilio.
    Header name: X-SignalWire-Signature  (not X-Twilio-Signature).
    Key: settings.signalwire_api_token.
    """
    if not settings.signalwire_api_token:
        return  # skip in dev / when not configured
    from twilio.request_validator import RequestValidator  # same algorithm works

    validator = RequestValidator(settings.signalwire_api_token)
    signature = request.headers.get("X-SignalWire-Signature", "")
    if not validator.validate(str(request.url), form_data, signature):
        raise HTTPException(status_code=403, detail="Invalid SignalWire signature")


@router.post("/call-status")
async def signalwire_call_status(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Receive SignalWire call-status callbacks (field names identical to Twilio)."""
    form_data = dict(await request.form())
    _validate_signalwire_signature(request, form_data)

    call_sid = form_data.get("CallSid")
    if not call_sid:
        logger.warning("SignalWire call-status missing CallSid")
        return Response(status_code=400)

    logger.info(
        "SignalWire call-status CallSid=%s status=%s",
        call_sid,
        form_data.get("CallStatus"),
    )
    repo = CallEventRepo(session)
    await repo.create_from_webhook(customer_id=None, payload=form_data)
    return Response(status_code=200)


@router.post("/voice")
async def signalwire_voice(request: Request) -> Response:
    """Handle inbound SignalWire calls — LaML is TwiML-compatible."""
    logger.info("SignalWire inbound voice")
    laml = "<Response><Say>VoiceGateway. Please hold.</Say></Response>"
    return Response(content=laml, media_type="text/xml")


@router.post("/sms")
async def signalwire_sms(request: Request) -> Response:
    """Handle inbound SignalWire SMS."""
    logger.info("SignalWire inbound SMS")
    return Response(status_code=204)
```

> **Agent note:** `CallEventRepo.create_from_webhook` currently accepts a
> `customer_id` argument. If `customer_id=None` is not a valid call, add a
> `customer_id` query-string param to the webhook URL when provisioning the DID
> (e.g., `…/webhooks/signalwire/call-status?customer_id={uuid}`) and extract it
> from `request.query_params.get("customer_id")` in the handler.

---

## Step 10 — Update Existing Twilio Webhook Handler

**File:** `app/api/webhooks/call_status.py`

Change the signature-validation function to use the Twilio-specific header name
as a named constant (it was previously implicit):

```python
# Change the header lookup from:
signature = request.headers.get("X-Twilio-Signature", "")
# No other changes needed — logic is the same.
```

This is a no-op change functionally; it's here only for clarity in the diff.

---

## Step 11 — Update API Routes

### Pattern for every route

**Before:**
```python
from app.services.twilio_provider import TwilioProvider
from twilio.base.exceptions import TwilioRestException
# ...
provider: TwilioProvider = request.app.state.twilio
try:
    result = await provider.some_method(...)
except TwilioRestException as exc:
    raise HTTPException(status_code=502, detail=f"Twilio error: {exc.msg}")
```

**After:**
```python
from app.services.base_provider import BaseVoIPProvider, VoIPProviderError
from app.services.provider_factory import ProviderFactory
# ...
factory: ProviderFactory = request.app.state.provider_factory
provider: BaseVoIPProvider = factory.primary()
try:
    result = await provider.some_method(...)
except VoIPProviderError as exc:
    raise HTTPException(status_code=502, detail=f"Provider error: {exc.message}")
```

### Return type changes (dataclasses instead of dicts)

Everywhere a route uses `result["sid"]`, `result["phone_number"]`,
`result["status"]`, or `result["call_sid"]`, update to attribute access:

| Old | New |
| --- | --- |
| `result["sid"]` | `result.sid` |
| `result["phone_number"]` | `result.phone_number` |
| `result["status"]` | `result.status` |
| `result["call_sid"]` | `result.call_sid` |

### Files to update

- `app/api/vsapi/phone_lines.py` — 3 routes use `app.state.twilio`
- `app/api/vsapi/sms.py` — 3 routes; **`send_sms` route uses `factory.failover_send_sms()`**
- `app/api/vsapi/voicemail_drop.py` — 1 route; **uses `factory.failover_call()`**
- `app/api/vsapi/extensions.py` — 2 routes; no failover (SIP ops are not latency-sensitive)
- `app/api/vsapi/area_codes.py` — uses `factory.primary()`

### `phone_lines.py` — specific diff for `add_phone_line`

The `line_repo.create()` call currently passes `twilio_sid=result["sid"]`.
After the refactor it becomes:

```python
line = await line_repo.create(
    customer_id=customer.id,
    phone_number=result.phone_number,
    twilio_sid=result.sid,          # column name unchanged (see Step 12 note)
    provider=factory.primary().__class__.__name__.lower().replace("provider", ""),
)
```

The `provider` column records which provider owns the DID (see Step 12).

### SMS failover example (`sms.py`)

```python
factory: ProviderFactory = request.app.state.provider_factory
try:
    result = await factory.failover_send_sms(
        from_number=body.from_number,
        to_number=body.to_number,
        body=body.message,
    )
except VoIPProviderError as exc:
    raise HTTPException(status_code=502, detail=f"Provider error: {exc.message}")
```

---

## Step 12 — Database Migration

**Generate with:**
```bash
alembic revision --autogenerate -m "add provider fields to customers phone_lines extensions"
```

**Review the generated file and ensure it includes these columns. Autogenerate
may miss `server_default` values — add them manually if absent.**

### `customers` table

```python
sa.Column("provider", sa.String(32), nullable=False, server_default="twilio"),
sa.Column("signalwire_project_id", sa.String(64), nullable=True),
sa.Column("signalwire_api_token", sa.String(128), nullable=True),
sa.Column("signalwire_space_url", sa.String(128), nullable=True),
```

(The per-customer SW credentials are stored here now even though the PoC routes
don't use them yet — this avoids a second migration later.)

### `phone_lines` table

```python
sa.Column("provider", sa.String(32), nullable=False, server_default="twilio"),
```

### `extensions` table

```python
sa.Column("provider", sa.String(32), nullable=False, server_default="twilio"),
```

**DO NOT rename** `twilio_sid`, `twilio_domain_sid`, or `sip_credential_sid`.
Those columns store provider SIDs regardless of provider — the naming is
legacy and is out of scope.

**Apply:**
```bash
alembic upgrade head
```

---

## Step 13 — Model Changes

### `app/models/customer.py`

Add fields:
```python
provider: Mapped[str] = mapped_column(String(32), default="twilio")
signalwire_project_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
signalwire_api_token: Mapped[str | None] = mapped_column(String(128), nullable=True)
signalwire_space_url: Mapped[str | None] = mapped_column(String(128), nullable=True)
```

### `app/models/phone_line.py`

Add:
```python
provider: Mapped[str] = mapped_column(String(32), default="twilio")
```

### `app/models/extension.py`

Add:
```python
provider: Mapped[str] = mapped_column(String(32), default="twilio")
```

---

## Step 14 — Schema Changes

### `app/schemas/customers.py`

Add to `CustomerCreate`:
```python
provider: str = "twilio"
signalwire_project_id: str | None = None
signalwire_api_token: str | None = None   # stored but never returned
signalwire_space_url: str | None = None
```

Add to `CustomerResponse`:
```python
provider: str
```

**Never expose** `signalwire_api_token` in any response schema — treat it the
same as `twilio_auth_token` (write-only credential).

---

## Step 15 — Tests

### Unit tests (new file: `tests/unit/test_provider_factory.py`)

```python
# Test ProviderFactory.primary() returns the first configured provider in order
# Test ProviderFactory.failover_send_sms() returns first success
# Test ProviderFactory.failover_send_sms() skips failed providers and tries next
# Test ProviderFactory.failover_send_sms() raises VoIPProviderError when all fail
# Same patterns for failover_call()
```

### Unit tests (new file: `tests/unit/test_signalwire_provider.py`)

```python
# Mock signalwire.rest.Client
# Test purchase_did() — area_code path and phone_number path
# Test release_did()
# Test send_sms() returns SmsResult
# Test initiate_voicemail_drop() returns CallResult
# Test each method raises VoIPProviderError on TwilioRestException
```

### Unit tests — update existing Twilio tests

- `tests/unit/test_twilio_provider.py`: Update expected return types from
  `dict` to `DidResult`, `SmsResult`, `CallResult`, `AreaCode`.
- Update any route tests that mock `app.state.twilio` to mock
  `app.state.provider_factory` instead.

### Integration tests (new file: `tests/integration/test_signalwire_integration.py`)

Use SignalWire test project credentials (check SW docs for test credentials
analogous to Twilio's test SIDs). Mirror the structure of existing Twilio
integration tests.

---

## Verification Checklist

After implementation, verify:

- [ ] `alembic upgrade head` succeeds with no errors
- [ ] All existing unit tests pass unchanged
- [ ] `mypy app/` reports no new type errors
- [ ] `POST /vsapi/1.0.0/PhoneLine/Add` creates a `phone_lines` row with
      `provider="twilio"` when Twilio is primary
- [ ] Sending SMS with Twilio configured works end-to-end
- [ ] Sending SMS with only SignalWire credentials configured works end-to-end
- [ ] With `PROVIDER_FAILOVER_ORDER=twilio,signalwire` and mocked Twilio failure,
      SMS retries on SignalWire automatically
- [ ] `POST /webhooks/signalwire/call-status` returns `200` for a valid payload
- [ ] `POST /webhooks/twilio/call-status` still works unchanged
- [ ] No `import twilio` in `signalwire_provider.py` except for the `RequestValidator`
      and the re-exported exception class (both are acceptable)
- [ ] `GET /health` still returns `200`

---

## Known Risks / Agent Decision Points

1. **SignalWire exception class** — Confirm whether `signalwire.rest` re-exports
   `TwilioRestException` or has its own exception. Adjust the `except` clause in
   `SignalWireProvider` accordingly. If it's a different type, add it to the
   `except` tuple in each method.

2. **SignalWire SIP domain format** — The plan assumes `*.sip.signalwire.com`.
   Verify in SW docs before implementing `ensure_sip_domain`. If the format is
   different, update `SignalWireProvider.ensure_sip_domain` only — the rest is
   unaffected.

3. **`CallEventRepo.create_from_webhook` signature** — Check the current method
   signature. If `customer_id` is required (not nullable), either make it
   optional or embed it as a query param in the webhook URL at DID-provision time.

4. **`app.state.twilio` bug** — The current `main.py` stores the raw
   `twilio.rest.Client` on `app.state.twilio`, but routes type-hint it as
   `TwilioProvider`. This is a latent bug being fixed in this refactor. The fix
   is: store `ProviderFactory` on `app.state.provider_factory` and remove
   `app.state.twilio` entirely. Confirm no other code relies on `app.state.twilio`
   before removing it.

5. **Recording via `?record=true` on SignalWire** — SignalWire may handle
   recording differently. If the `voice_url` query-param trick doesn't work on
   SW, implement recording via their native recording API and document the
   difference in a `# SIGNALWIRE_DIFFERS:` comment.
