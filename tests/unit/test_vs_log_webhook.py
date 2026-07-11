"""Tests for the /webhooks/vs-log ingest endpoint (phase 03 — VanillaSoft log
shipping). Records are authenticated by the shared secret, re-emitted under a
``vs.``-prefixed logger, and never persisted."""

from __future__ import annotations

import logging

import pytest

from app.core.config import settings

pytestmark = pytest.mark.asyncio(loop_scope="session")

_WEBHOOK = "/webhooks/vs-log"
_SECRET = "vs-shared-secret"


def _entry(
    *,
    level: str = "ERROR",
    logger: str = "Carameli.Client",
    message: str = "boom talking to Carameli",
    exception: str | None = None,
    machine: str | None = "STAGING-01",
    auth: str | None = None,
) -> dict:
    body: dict = {
        "time": "2026-07-07 12:00:00.0000",
        "level": level,
        "logger": logger,
        "message": message,
        "machine": machine,
    }
    if exception is not None:
        body["exception"] = exception
    if auth is not None:
        body["auth"] = auth
    return body


async def test_happy_path_emits_under_vs_logger(client, caplog, monkeypatch):
    monkeypatch.setattr(settings, "vanillasoft_webhook_secret", _SECRET)
    with caplog.at_level(logging.DEBUG):
        resp = await client.post(_WEBHOOK, json=_entry(), headers={"X-Cloudli-Auth": _SECRET})

    assert resp.status_code == 204
    recs = [r for r in caplog.records if r.name == "vs.Carameli.Client"]
    assert recs, "expected a record under vs.Carameli.Client"
    rec = recs[-1]
    assert rec.levelno == logging.ERROR
    assert "[staging STAGING-01]" in rec.getMessage()
    assert "boom talking to Carameli" in rec.getMessage()


async def test_wrong_secret_returns_403(client, caplog, monkeypatch):
    monkeypatch.setattr(settings, "vanillasoft_webhook_secret", _SECRET)
    with caplog.at_level(logging.DEBUG):
        resp = await client.post(_WEBHOOK, json=_entry(), headers={"X-Cloudli-Auth": "wrong"})
    assert resp.status_code == 403
    assert not [r for r in caplog.records if r.name.startswith("vs.")]


async def test_secret_via_body_auth_field_accepted(client, monkeypatch):
    monkeypatch.setattr(settings, "vanillasoft_webhook_secret", _SECRET)
    # No X-Cloudli-Auth header — old NLog builds ship the secret in the body.
    resp = await client.post(_WEBHOOK, json=_entry(auth=_SECRET))
    assert resp.status_code == 204


async def test_secret_unconfigured_accepts_without_auth(client, monkeypatch):
    monkeypatch.setattr(settings, "vanillasoft_webhook_secret", None)
    resp = await client.post(_WEBHOOK, json=_entry())
    assert resp.status_code == 204


async def test_non_json_body_returns_400(client):
    resp = await client.post(
        _WEBHOOK, content=b"not json", headers={"Content-Type": "application/json"}
    )
    assert resp.status_code == 400


async def test_malformed_payload_returns_400(client, monkeypatch):
    monkeypatch.setattr(settings, "vanillasoft_webhook_secret", None)
    # Missing the required 'message' field.
    resp = await client.post(
        _WEBHOOK, json={"time": "t", "level": "ERROR", "logger": "Carameli.Client"}
    )
    assert resp.status_code == 400


async def test_oversized_message_and_exception_truncated(client, caplog, monkeypatch):
    monkeypatch.setattr(settings, "vanillasoft_webhook_secret", None)
    with caplog.at_level(logging.DEBUG):
        resp = await client.post(
            _WEBHOOK,
            json=_entry(message="m" * 5000, exception="e" * 9000),
        )
    assert resp.status_code == 204
    rec = [r for r in caplog.records if r.name == "vs.Carameli.Client"][-1]
    text = rec.getMessage()
    assert "...[truncated]" in text
    # Message capped at 2000, exception at 4000 — full 5000/9000 must not survive.
    assert "m" * 5000 not in text
    assert "e" * 9000 not in text


async def test_unknown_level_maps_to_warning(client, caplog, monkeypatch):
    monkeypatch.setattr(settings, "vanillasoft_webhook_secret", None)
    with caplog.at_level(logging.DEBUG):
        resp = await client.post(_WEBHOOK, json=_entry(level="BOGUS"))
    assert resp.status_code == 204
    rec = [r for r in caplog.records if r.name == "vs.Carameli.Client"][-1]
    assert rec.levelno == logging.WARNING


async def test_warn_level_maps_to_warning(client, caplog, monkeypatch):
    monkeypatch.setattr(settings, "vanillasoft_webhook_secret", None)
    with caplog.at_level(logging.DEBUG):
        resp = await client.post(_WEBHOOK, json=_entry(level="WARN"))
    assert resp.status_code == 204
    rec = [r for r in caplog.records if r.name == "vs.Carameli.Client"][-1]
    assert rec.levelno == logging.WARNING
