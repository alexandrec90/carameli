"""Cookie-based session utilities.

Signs and verifies session cookies using HMAC-SHA256 so the frontend
can authenticate via HttpOnly cookies instead of embedding an API key
in the JavaScript bundle.
"""

from __future__ import annotations

import base64
import hashlib
import hmac

from app.core.config import settings

COOKIE_NAME = "carameli_session"


def sign_token(token: str) -> str:
    """Return ``token.signature`` where signature = HMAC-SHA256(secret, token)."""
    sig = hmac.new(settings.session_secret.encode(), token.encode(), hashlib.sha256).digest()
    encoded = base64.urlsafe_b64encode(sig).decode().rstrip("=")
    return f"{token}.{encoded}"


def verify_signed_token(signed: str) -> str | None:
    """Verify and extract the token from a signed cookie value.

    Returns the original token on success, ``None`` on failure.
    """
    parts = signed.rsplit(".", 1)
    if len(parts) != 2:
        return None
    token, provided_sig = parts
    expected_sig = hmac.new(
        settings.session_secret.encode(), token.encode(), hashlib.sha256
    ).digest()
    expected_encoded = base64.urlsafe_b64encode(expected_sig).decode().rstrip("=")
    if hmac.compare_digest(provided_sig, expected_encoded):
        return token
    return None
