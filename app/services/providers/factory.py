from __future__ import annotations

from app.core.config import settings
from app.services.providers.base import CallEngineProvider, CarrierProvider


def get_carrier_provider() -> CarrierProvider:
    if settings.carrier_provider == "telnyx":
        from app.services.providers.carrier.telnyx import TelnyxCarrier  # type: ignore[import]
        return TelnyxCarrier(
            api_key=settings.telnyx_api_key,
            webhook_base_url=settings.telnyx_webhook_base_url,
        )
    raise ValueError(f"Unknown carrier provider: {settings.carrier_provider!r}")


def get_call_engine_provider() -> CallEngineProvider:
    if settings.call_engine_provider == "jambonz":
        from app.services.providers.engine.jambonz import JambonzEngine  # type: ignore[import]
        return JambonzEngine(
            base_url=settings.jambonz_base_url,
            api_key=settings.jambonz_api_key,
            account_sid=settings.jambonz_account_sid,
            webhook_base_url=settings.jambonz_webhook_base_url,
        )
    raise ValueError(f"Unknown call engine provider: {settings.call_engine_provider!r}")
