"""Unit coverage for ``scripts/provision-softphone.py``.

The script's whole job is to turn three API calls into one command and hand an operator
a password that works, so the properties worth pinning are the ones that would make it
hand over settings a softphone silently refuses:

- **A generated password clears the server's 12-character floor.** ``token_urlsafe``
  takes a byte count, not a character count, so the obvious spelling can return a
  string shorter than requested; the floor is the server's, and failing it turns into
  a 422 rather than an error message.
- **A missing SIP realm is an error, not a printed blank.** An extension with no
  ``sip_domain_sid`` registers nowhere, and the symptom is a softphone that never
  connects with nothing in any log to say why.
- **``ensure_customer`` is idempotent.** The demo tenant gets re-provisioned every time
  someone re-runs the script, and a 409 on the second run must not be an error.
"""

from __future__ import annotations

import importlib.util
import json
import sys
import urllib.request
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "provision-softphone.py"

# The rendered password is what these tests assert on, so it has to be a literal
# somewhere. Naming it once keeps the suppression to one line instead of five.
_TEST_PASSWORD = "s3cret-pass-1"  # pragma: allowlist secret - fixture; no server accepts it


def _load_script() -> Any:
    """Import ``scripts/provision-softphone.py`` by path.

    The dash in the filename is deliberate -- every script in ``scripts/`` is spelled
    that way -- so a plain ``import`` cannot reach it. The ``sys.modules`` registration
    before ``exec_module`` is load-bearing: ``@dataclass`` resolves its annotations
    through ``sys.modules[cls.__module__].__dict__``.
    """
    spec = importlib.util.spec_from_file_location("provision_softphone", SCRIPT_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


script = _load_script()


class _RecordingOpener:
    """Stand-in for ``ApiClient``'s opener that replays queued responses."""

    def __init__(self, responses: list[tuple[int, str]]) -> None:
        self._responses = list(responses)
        self.calls: list[tuple[str, str, dict[str, Any] | None]] = []

    def __call__(self, request: urllib.request.Request) -> tuple[int, str]:
        body = json.loads(request.data.decode("utf-8")) if request.data else None
        self.calls.append((request.get_method(), request.full_url, body))
        if not self._responses:
            raise AssertionError(f"unexpected extra request: {request.full_url}")
        return self._responses.pop(0)


def _client(responses: list[tuple[int, str]]) -> tuple[Any, _RecordingOpener]:
    opener = _RecordingOpener(responses)
    return script.ApiClient("http://carameli.test/", "key-123", opener=opener), opener


# --- password generation ---------------------------------------------------------


@pytest.mark.parametrize("length", [12, 20, 64])
def test_generate_password_returns_exactly_the_requested_length(length: int) -> None:
    assert len(script.generate_password(length)) == length


def test_generate_password_default_clears_the_server_floor() -> None:
    assert len(script.generate_password()) >= script.MIN_PASSWORD_LENGTH


def test_generate_password_rejects_a_length_below_the_server_floor() -> None:
    with pytest.raises(ValueError, match="must be >= 12"):
        script.generate_password(11)


def test_generate_password_is_not_constant() -> None:
    assert script.generate_password() != script.generate_password()


# --- request body construction ---------------------------------------------------


def test_build_extension_body_omits_unset_names() -> None:
    body = script.build_extension_body(
        extension_number="101", vs_customer_id=9001, password="a" * 20
    )
    assert body == {"extension_number": "101", "vs_customer_id": 9001, "password": "a" * 20}


def test_build_extension_body_includes_names_when_given() -> None:
    body = script.build_extension_body(
        extension_number="101",
        vs_customer_id=9001,
        password="a" * 20,
        first_name="Demo",
        last_name="Agent",
    )
    assert body["first_name"] == "Demo"
    assert body["last_name"] == "Agent"


# --- account rendering -----------------------------------------------------------


def _extension_payload(**overrides: Any) -> dict[str, Any]:
    payload = {
        "extension_number": "101",
        "sip_username": "cust-101",
        "sip_domain_sid": "demo.sip.jambonz.cloud",
    }
    payload.update(overrides)
    return payload


def test_account_from_extension_builds_the_dialable_uri() -> None:
    account = script.account_from_extension(_extension_payload(), password=_TEST_PASSWORD)
    assert account.sip_uri == "sip:cust-101@demo.sip.jambonz.cloud"
    assert account.transport == "udp"


def test_account_from_extension_rejects_a_missing_sip_realm() -> None:
    with pytest.raises(ValueError, match="sip_domain_sid"):
        script.account_from_extension(
            _extension_payload(sip_domain_sid=None), password=_TEST_PASSWORD
        )


def test_account_from_extension_rejects_a_missing_username() -> None:
    with pytest.raises(ValueError, match="sip_username"):
        script.account_from_extension(_extension_payload(sip_username=""), password=_TEST_PASSWORD)


def test_render_account_prints_every_value_needed_to_register() -> None:
    account = script.account_from_extension(
        _extension_payload(), password=_TEST_PASSWORD, transport="tls"
    )
    rendered = script.render_account(account, did="+15145550100")
    for expected in (
        "demo.sip.jambonz.cloud",
        "cust-101",
        _TEST_PASSWORD,
        "TLS",
        "+15145550100",
    ):
        assert expected in rendered


def test_render_account_omits_the_did_line_when_none_is_attached() -> None:
    account = script.account_from_extension(_extension_payload(), password=_TEST_PASSWORD)
    assert "Inbound DID" not in script.render_account(account)


# --- API client ------------------------------------------------------------------


def test_request_sends_the_bearer_key_and_parses_json() -> None:
    client, opener = _client([(200, json.dumps({"ok": True}))])
    assert client.request("GET", "/api/v1/thing") == {"ok": True}
    assert opener.calls == [("GET", "http://carameli.test/api/v1/thing", None)]


def test_request_raises_apierror_carrying_the_status_and_body() -> None:
    client, _ = _client([(404, '{"detail":"Customer not found"}')])
    with pytest.raises(script.ApiError) as excinfo:
        client.request("GET", "/api/v1/thing")
    assert excinfo.value.status == 404
    assert "Customer not found" in excinfo.value.body


def test_request_tolerates_an_empty_body() -> None:
    client, _ = _client([(204, "")])
    assert client.request("DELETE", "/api/v1/thing") is None


# --- call sequences --------------------------------------------------------------


def test_ensure_customer_is_a_noop_when_the_customer_exists() -> None:
    client, opener = _client([(200, json.dumps({"vs_customer_id": 9001}))])
    assert script.ensure_customer(client, 9001) is False
    assert len(opener.calls) == 1


def test_ensure_customer_creates_on_404() -> None:
    client, opener = _client([(404, '{"detail":"not found"}'), (201, json.dumps({"id": "x"}))])
    assert script.ensure_customer(client, 9001) is True
    assert opener.calls[1][0] == "POST"
    assert opener.calls[1][2] == {"vs_customer_id": 9001}


def test_ensure_customer_treats_a_create_race_as_success() -> None:
    client, _ = _client([(404, "{}"), (409, '{"detail":"Customer already exists"}')])
    assert script.ensure_customer(client, 9001) is False


def test_ensure_customer_propagates_an_auth_failure() -> None:
    client, _ = _client([(401, '{"detail":"Unauthorized"}')])
    with pytest.raises(script.ApiError):
        script.ensure_customer(client, 9001)


def test_provision_extension_posts_to_the_rest_route() -> None:
    client, opener = _client([(201, json.dumps(_extension_payload()))])
    result = script.provision_extension(
        client, extension_number="101", vs_customer_id=9001, password="a" * 20
    )
    assert result["sip_username"] == "cust-101"
    assert opener.calls[0][1] == "http://carameli.test/api/v1/extensions"


def test_attach_did_posts_the_pointer_body() -> None:
    client, opener = _client([(200, json.dumps({"success": True}))])
    script.attach_did(client, vs_customer_id=9001, did="+15145550100", extension_number="101")
    assert opener.calls[0][2] == {
        "vs_customer_id": 9001,
        "phone_number": "+15145550100",
        "extension_number": "101",
    }


# --- configuration ---------------------------------------------------------------


def _args(**overrides: Any) -> Any:
    argv = ["--extension", "101", "--vs-customer-id", "9001"]
    for key, value in overrides.items():
        argv += [f"--{key.replace('_', '-')}", str(value)]
    return script.build_parser().parse_args(argv)


def test_resolve_config_defaults_to_localhost_with_the_env_key() -> None:
    assert script.resolve_config(_args(), {"API_KEY_SECRET": "k"}) == ("http://localhost:8000", "k")


def test_resolve_config_prefers_the_dedicated_env_var() -> None:
    resolved = script.resolve_config(
        _args(),
        {
            "CARAMELI_API_KEY": "dedicated",
            "API_KEY_SECRET": "fallback",
        },  # pragma: allowlist secret - fixture env, asserts precedence
    )
    assert resolved == ("http://localhost:8000", "dedicated")


def test_resolve_config_prefers_explicit_flags_over_the_environment() -> None:
    resolved = script.resolve_config(
        _args(
            base_url="https://demo.example", api_key="flag"
        ),  # pragma: allowlist secret - fixture flag value
        {
            "CARAMELI_BASE_URL": "http://ignored",
            "CARAMELI_API_KEY": "ignored",
        },  # pragma: allowlist secret - fixture env, asserted to be ignored
    )
    assert resolved == ("https://demo.example", "flag")


def test_resolve_config_explains_a_missing_key_rather_than_failing_later() -> None:
    resolved = script.resolve_config(_args(), {})
    assert isinstance(resolved, str)
    assert "API_KEY_SECRET" in resolved


def test_main_exits_unconfigured_without_a_key(capsys: pytest.CaptureFixture[str]) -> None:
    code = script.main(["--extension", "101", "--vs-customer-id", "9001"], environ={})
    assert code == script.EXIT_UNCONFIGURED
    assert "API key" in capsys.readouterr().err


def test_main_rejects_a_short_explicit_password(capsys: pytest.CaptureFixture[str]) -> None:
    code = script.main(
        ["--extension", "101", "--vs-customer-id", "9001", "--password", "short"],
        environ={"API_KEY_SECRET": "k"},
    )
    assert code == script.EXIT_UNCONFIGURED
    assert "at least 12" in capsys.readouterr().err
