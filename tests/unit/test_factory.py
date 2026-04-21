from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")


def test_get_carrier_provider_telnyx() -> None:
    from app.services.providers.carrier.telnyx import TelnyxCarrier
    from app.services.providers.factory import get_carrier_provider

    provider = get_carrier_provider()
    assert isinstance(provider, TelnyxCarrier)


def test_get_carrier_provider_unknown_raises(monkeypatch) -> None:
    from app.core.config import settings
    from app.services.providers.factory import get_carrier_provider

    monkeypatch.setattr(settings, "carrier_provider", "nonexistent")
    with pytest.raises(ValueError, match="nonexistent"):
        get_carrier_provider()


def test_get_call_engine_provider_jambonz() -> None:
    from app.services.providers.engine.jambonz import JambonzEngine
    from app.services.providers.factory import get_call_engine_provider

    provider = get_call_engine_provider()
    assert isinstance(provider, JambonzEngine)


def test_get_call_engine_provider_unknown_raises(monkeypatch) -> None:
    from app.core.config import settings
    from app.services.providers.factory import get_call_engine_provider

    monkeypatch.setattr(settings, "call_engine_provider", "nonexistent")
    with pytest.raises(ValueError, match="nonexistent"):
        get_call_engine_provider()
