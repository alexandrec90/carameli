"""Unit-test isolation from developer-configured external integrations."""

from __future__ import annotations

import pytest

from app.core.config import settings


@pytest.fixture(autouse=True)
def disable_external_integrations(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep unit behavior independent of credentials loaded from a local ``.env``.

    Tests that exercise one of these integrations enable it explicitly.  Without
    this baseline, a configured development stack can turn expected no-auth or
    no-storage paths into signed-webhook 403s and live S3 behavior.
    """
    disabled = {
        "s3_bucket": "",
        "s3_endpoint": "",
        "s3_access_key_id": "",
        "s3_secret_access_key": "",
        "telnyx_webhook_secret": "",
        "jambonz_webhook_secret": "",
        "sip_credential_encryption_secret": "unit-test-sip-secret-at-least-32-characters",  # pragma: allowlist secret
        "crm_webhook_url": None,
        "crm_webhook_secret": None,
        "crm_notify_prefix": "notify",
        "carameli_notify_secret": None,
    }
    for name, value in disabled.items():
        monkeypatch.setattr(settings, name, value)
