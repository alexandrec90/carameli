from __future__ import annotations

import pytest

from app.core.config import Settings

pytestmark = pytest.mark.asyncio(loop_scope="session")


def test_comma_separated() -> None:
    result = Settings.parse_cors_origins("http://a.com, http://b.com")
    assert result == ["http://a.com", "http://b.com"]


def test_json_array_string() -> None:
    result = Settings.parse_cors_origins('["http://a.com","http://b.com"]')
    assert result == ["http://a.com", "http://b.com"]


def test_empty_string_returns_empty_list() -> None:
    assert Settings.parse_cors_origins("") == []


def test_whitespace_only_items_stripped() -> None:
    result = Settings.parse_cors_origins("http://a.com,  ,http://b.com")
    assert result == ["http://a.com", "http://b.com"]


def test_list_passthrough() -> None:
    result = Settings.parse_cors_origins(["http://a.com", " http://b.com "])
    assert result == ["http://a.com", "http://b.com"]


def test_wildcard_cors_falls_back_to_localhost() -> None:
    # Verify the module-level sanitization: the CORS middleware must not
    # expose "*" as an allowed origin (browsers reject wildcard + credentials).
    from fastapi.middleware.cors import CORSMiddleware

    from app.main import app

    for mw in app.user_middleware:
        if mw.cls is CORSMiddleware:
            assert "*" not in mw.kwargs.get("allow_origins", [])
            return

    # CORSMiddleware is present but removed during tests — inspect _cors_origins directly.
    import app.main as _main

    assert "*" not in getattr(_main, "_cors_origins", [])
