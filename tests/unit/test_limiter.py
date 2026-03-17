from __future__ import annotations

from unittest.mock import MagicMock

from app.core.limiter import _key_by_api_key


def _make_request(auth_header: str | None = None, client_host: str = "1.2.3.4") -> MagicMock:
    req = MagicMock()
    req.headers.get.return_value = auth_header or ""
    req.client.host = client_host
    return req


def test_keys_by_bearer_token() -> None:
    req = _make_request("Bearer mytoken123")
    assert _key_by_api_key(req) == "mytoken123"


def test_falls_back_to_ip_when_no_auth() -> None:
    req = _make_request(auth_header=None)
    assert _key_by_api_key(req) == "1.2.3.4"


def test_falls_back_to_ip_for_non_bearer_scheme() -> None:
    req = _make_request("Basic dXNlcjpwYXNz")
    assert _key_by_api_key(req) == "1.2.3.4"


def test_empty_bearer_token_is_used_as_key() -> None:
    # "Bearer " with nothing after it — unusual but should not crash
    req = _make_request("Bearer ")
    assert _key_by_api_key(req) == ""
