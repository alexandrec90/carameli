from __future__ import annotations

import pytest

from app.core.session import COOKIE_NAME, sign_token, verify_signed_token

pytestmark = pytest.mark.asyncio(loop_scope="session")


def test_sign_and_verify_roundtrip() -> None:
    signed = sign_token("my-token")
    assert verify_signed_token(signed) == "my-token"


def test_tampered_signature_returns_none() -> None:
    signed = sign_token("my-token")
    tampered = signed[:-3] + "xxx"
    assert verify_signed_token(tampered) is None


def test_missing_dot_returns_none() -> None:
    assert verify_signed_token("nodot") is None


def test_empty_string_returns_none() -> None:
    assert verify_signed_token("") is None


def test_cookie_name_constant_is_carameli_session() -> None:
    assert COOKIE_NAME == "carameli_session"
