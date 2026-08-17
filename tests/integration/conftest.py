"""Integration-test defaults for settings the app now requires at runtime."""

from __future__ import annotations

import pytest

from app.core.config import settings


@pytest.fixture(autouse=True)
def provisioning_secrets(monkeypatch: pytest.MonkeyPatch) -> None:
    """Give extension provisioning an encryption secret.

    Creating an extension provisions a SIP client and stores its password
    encrypted until ``AccessCheck/AccountData`` delivers it, so the endpoint
    answers 503 when ``SIP_CREDENTIAL_ENCRYPTION_SECRET`` is unset. CI has no
    ``.env``, and a developer's may not carry the key either; without this the
    whole extension surface fails on configuration rather than behavior.
    """
    monkeypatch.setattr(
        settings,
        "sip_credential_encryption_secret",
        "integration-test-sip-secret-at-least-32-characters",  # pragma: allowlist secret
    )
