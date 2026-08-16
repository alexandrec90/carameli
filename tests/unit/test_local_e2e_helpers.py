"""Unit coverage for the pure parts of ``tests/local_e2e/helpers.py``.

The local integration suite only runs on a machine that has both a remote Carameli and a
local VanillaLand IIS, so it never runs in CI. These tests are the same-commit coverage
for its logic, and — more importantly — they are the guard on the *duplicated* signing
implementation: ``helpers.sign_payload`` is written independently of
``app.services.vanillasoft_notify.sign_payload`` so it can cross-check it, and a test
here pins the two together so the duplicate cannot drift into agreement-by-accident or
disagreement-by-neglect.
"""

from __future__ import annotations

import uuid
from typing import ClassVar

import httpx
import pytest

from app.services import vanillasoft_notify
from tests.local_e2e import helpers


class TestSigning:
    def test_signature_matches_a_fixed_vector(self) -> None:
        """Pins the exact wire format against a hand-computed value.

        Both a Python and a C# implementation must reproduce this string; hard-coding it
        means a change to either side shows up as a failing test rather than as 401s in
        live traffic.
        """
        signature = helpers.sign_payload(b'{"a":1}', 1_700_000_000, "s3cret")
        assert signature == (
            "t=1700000000,v1=1698a50bc74d1ff1db85c4e0a5297c2ad9fdba245d5737cdb789e4cc6e098940"
        )

    def test_signature_agrees_with_the_production_implementation(self) -> None:
        """The test-side duplicate and the shipped signer produce identical output."""
        body = b'{"callId":"abc","customerId":42}'
        assert helpers.sign_payload(body, 1_700_000_000, "shared") == (
            vanillasoft_notify.sign_payload(body, 1_700_000_000, "shared")
        )

    def test_replay_tolerance_matches_the_production_constant(self) -> None:
        """A wider tolerance here than in production would hide a replay-window bug."""
        assert helpers.SIGNATURE_TOLERANCE_SECONDS == (
            vanillasoft_notify.SIGNATURE_TOLERANCE_SECONDS
        )

    def test_signature_covers_the_timestamp(self) -> None:
        """Two timestamps over the same body must not share a MAC."""
        body = b"{}"
        assert helpers.sign_payload(body, 1, "k") != helpers.sign_payload(body, 2, "k")

    def test_signed_headers_include_the_ngrok_optout(self) -> None:
        """Notifies may travel through a tunnel; the interstitial must never intercept."""
        headers = helpers.signed_headers(b"{}", "k", 1_700_000_000)
        assert headers["ngrok-skip-browser-warning"] == "1"
        assert headers["Content-Type"] == "application/json"
        assert headers[helpers.SIGNATURE_HEADER].startswith("t=1700000000,v1=")


class TestCanonicalBody:
    def test_uses_compact_separators(self) -> None:
        """The signed bytes must be the posted bytes; whitespace would break the MAC."""
        assert helpers.canonical_body({"a": 1, "b": "x"}) == b'{"a":1,"b":"x"}'

    def test_matches_what_the_production_sender_posts(self) -> None:
        """Same serialization as ``post_notification``, which signs then posts verbatim."""
        import json

        payload = {"callId": "z", "nested": {"k": [1, 2]}}
        assert (
            helpers.canonical_body(payload) == json.dumps(payload, separators=(",", ":")).encode()
        )


class TestSyntheticCallId:
    """``callIdUuid`` reaches SQL Server as a ``uniqueidentifier``.

    A malformed id fails the cast before the insert is attempted, so the shape is the
    whole contract. These also pin the module against a regression that made the file
    unimportable: the id was built with ``{uuid.uuid4()!s[9:]}``, which is a SyntaxError
    (a slice cannot follow the ``!s`` conversion), and because ``helpers`` is imported at
    module scope here it took the entire backend collection down with it.
    """

    def test_is_a_parseable_guid(self) -> None:
        assert uuid.UUID(helpers.synthetic_call_id())

    def test_carries_the_greppable_prefix(self) -> None:
        """Cleanup keys off this prefix — see the DELETE in the helpers docstring."""
        call_id = helpers.synthetic_call_id()
        assert call_id.startswith(f"{helpers.SYNTHETIC_GUID_PREFIX}-")
        assert len(call_id) == 36

    def test_prefix_is_valid_hex(self) -> None:
        """The tag survives only because every character is a hex digit — that is the
        whole reason it is leetspeak rather than a readable word."""
        assert all(character in "0123456789abcdef" for character in helpers.SYNTHETIC_GUID_PREFIX)

    def test_is_unique_per_call(self) -> None:
        """A shared id across rows would make the suite's inserts collide."""
        assert len({helpers.synthetic_call_id() for _ in range(100)}) == 100


class TestConfig:
    ENV: ClassVar[dict[str, str]] = {
        "CARAMELI_BASE_URL": "https://example.ngrok-free.dev/",
        "CARAMELI_API_KEY": "key",
        "CARAMELI_VS_CUSTOMER_ID": "77",
        "VS_LOCAL_BASE_URL": "http://localhost:8021/cloudli/",
        "VS_CARAMELI_NOTIFY_SECRET": "shh",
    }

    def _apply(self, monkeypatch: pytest.MonkeyPatch, **overrides: str | None) -> None:
        for name in (
            *helpers.REQUIRED_ENV,
            "RUN_LOCAL_E2E",
            "VS_PUBLIC_BASE_URL",
            "VS_WEBHOOK_SECRET",
            "ES_URL",
            "ES_INDEX",
        ):
            monkeypatch.delenv(name, raising=False)
        for name, value in {**self.ENV, **overrides}.items():
            if value is not None:
                monkeypatch.setenv(name, value)

    def test_from_env_strips_trailing_slashes(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """URLs are joined with explicit slashes, so a trailing one would double up."""
        self._apply(monkeypatch)
        config = helpers.LocalE2EConfig.from_env()
        assert config is not None
        assert config.carameli_base_url == "https://example.ngrok-free.dev"
        assert config.vs_local_base_url == "http://localhost:8021/cloudli"

    def test_from_env_applies_elasticsearch_defaults(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self._apply(monkeypatch)
        config = helpers.LocalE2EConfig.from_env()
        assert config is not None
        assert config.es_url == "http://localhost:9200"
        assert config.es_index == "vanillasoft_dev.events"

    def test_from_env_returns_none_when_a_required_var_is_missing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        self._apply(monkeypatch, CARAMELI_API_KEY=None)
        assert helpers.LocalE2EConfig.from_env() is None

    def test_from_env_returns_none_for_a_non_integer_customer_id(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A typo must skip the suite, not explode during collection."""
        self._apply(monkeypatch, CARAMELI_VS_CUSTOMER_ID="seventy-seven")
        assert helpers.LocalE2EConfig.from_env() is None

    def test_blank_optional_url_becomes_none(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """An empty ``VS_PUBLIC_BASE_URL`` must skip the tunnel tests, not target ''."""
        self._apply(monkeypatch, VS_PUBLIC_BASE_URL="")
        config = helpers.LocalE2EConfig.from_env()
        assert config is not None
        assert config.vs_public_base_url is None


class TestSkipReason:
    def test_disabled_without_the_opt_in(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("RUN_LOCAL_E2E", raising=False)
        assert helpers.local_e2e_skip_reason() == (
            "Set RUN_LOCAL_E2E=1 to run the local integration suite"
        )

    def test_names_every_missing_variable(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """The reason must be actionable — list what to set, not just that it is unset."""
        for name in helpers.REQUIRED_ENV:
            monkeypatch.delenv(name, raising=False)
        monkeypatch.setenv("RUN_LOCAL_E2E", "1")
        reason = helpers.local_e2e_skip_reason()
        assert reason is not None
        for name in helpers.REQUIRED_ENV:
            assert name in reason

    def test_none_when_fully_configured(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("RUN_LOCAL_E2E", "1")
        for name, value in TestConfig.ENV.items():
            monkeypatch.setenv(name, value)
        assert helpers.local_e2e_skip_reason() is None


class TestLoadDotenv:
    def test_parses_and_does_not_override_real_environment(
        self, tmp_path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Real env vars win, so a one-off override on the command line still works."""
        env_file = tmp_path / ".env.local-e2e"
        env_file.write_text(
            "\n".join(
                [
                    "# a comment",
                    "",
                    'QUOTED="quoted-value"',
                    "PLAIN = plain-value",
                    "ALREADY_SET=from-file",
                    "not-a-pair",
                ]
            ),
            encoding="utf-8",
        )
        monkeypatch.delenv("QUOTED", raising=False)
        monkeypatch.delenv("PLAIN", raising=False)
        monkeypatch.setenv("ALREADY_SET", "from-environment")

        helpers.load_dotenv(env_file)

        import os

        assert os.environ["QUOTED"] == "quoted-value"
        assert os.environ["PLAIN"] == "plain-value"
        assert os.environ["ALREADY_SET"] == "from-environment"

    def test_missing_file_is_not_an_error(self, tmp_path) -> None:
        helpers.load_dotenv(tmp_path / "nope")


class TestAssertJson:
    def test_returns_the_parsed_body(self) -> None:
        response = httpx.Response(
            200, json={"status": "ok"}, request=httpx.Request("GET", "http://x/")
        )
        assert helpers.assert_json(response, "ctx") == {"status": "ok"}

    def test_rejects_the_ngrok_interstitial_despite_its_200(self) -> None:
        """The trap this whole helper exists for: HTML served with a success status."""
        response = httpx.Response(
            200,
            headers={"content-type": "text/html"},
            text="<!DOCTYPE html><html>You are about to visit an ngrok tunnel</html>",
            request=httpx.Request("GET", "http://x/"),
        )
        with pytest.raises(AssertionError, match="ngrok"):
            helpers.assert_json(response, "remote /health")

    def test_error_message_names_the_context(self) -> None:
        response = httpx.Response(
            500,
            headers={"content-type": "text/plain"},
            text="boom",
            request=httpx.Request("GET", "http://x/"),
        )
        with pytest.raises(AssertionError, match="GET /api/v1/extensions"):
            helpers.assert_json(response, "GET /api/v1/extensions")


class TestDescribe:
    def test_includes_status_and_body(self) -> None:
        """Failure messages must carry the honest receiver's reason, not just a code."""
        response = httpx.Response(
            500,
            text="Invalid column name 'VoipVendor'.",
            request=httpx.Request("POST", "http://x/"),
        )
        described = helpers.describe(response)
        assert "500" in described
        assert "VoipVendor" in described


class TestPollUntil:
    async def test_returns_the_first_truthy_value(self) -> None:
        values = iter([None, [], ["found"]])

        async def probe() -> object:
            return next(values)

        assert await helpers.poll_until(probe, timeout_s=5, interval_s=0) == ["found"]

    async def test_timeout_message_reports_the_last_value(self) -> None:
        """The timeout message is the debugging artefact; it must carry evidence."""

        async def probe() -> list[str]:
            return []

        with pytest.raises(TimeoutError, match=r"last value: \[\]"):
            await helpers.poll_until(probe, timeout_s=0, interval_s=0, description="a document")

    async def test_timeout_message_names_the_condition(self) -> None:
        async def probe() -> None:
            return None

        with pytest.raises(TimeoutError, match="the marker document"):
            await helpers.poll_until(
                probe, timeout_s=0, interval_s=0, description="the marker document"
            )


class TestPayloadBuilders:
    def test_incoming_call_payload_uses_the_dotnet_key_casing(self) -> None:
        """Keys bind to ``IncomingCall.cs`` by name; a rename binds to null and 400s."""
        payload = helpers.incoming_call_payload(
            call_sid="CA1",
            vs_customer_id=42,
            from_number="+15145550100",
            to_number="+15145550101",
        )
        assert set(payload) == {
            "callId",
            "callIdUuid",
            "timestamp",
            "from",
            "fromName",
            "fromNumber",
            "to",
            "toNumber",
            "accountId",
            "eventName",
            "isInbound",
            "customerId",
        }
        assert payload["accountId"] == "42"
        assert payload["customerId"] == 42

    def test_sms_payload_keeps_the_legacy_type_asymmetry(self) -> None:
        """``customerId`` is a string on the SMS routes and an int on IncomingCall."""
        payload = helpers.sms_message_payload(
            message_sid="SM1",
            vs_customer_id=42,
            from_number="+15145550100",
            to_number="+15145550101",
            body="hello",
        )
        assert payload["customerId"] == "42"
        assert payload["to"] == ["+15145550101"]
        assert payload["smsProviderName"] == "Carameli"

    def test_recording_payload_never_uses_the_dropped_source(self) -> None:
        """VanillaSoft's legacy receiver silently drops recordings sourced 'asterisk'."""
        payload = helpers.call_recording_payload(
            call_sid="CA1",
            vs_customer_id=42,
            from_number="+15145550100",
            to_number="+15145550101",
            recording_url="https://example.test/r.mp3",
        )
        assert payload["source"] == "carameli"
        assert payload["callIdParent"] == "CA1"
