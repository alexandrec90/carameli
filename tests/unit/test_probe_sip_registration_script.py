"""Tests for scripts/probe-sip-registration.py.

The script's whole value is telling a refusal apart from a network failure, so that is
what these assert: 401 is success, 403 is a refusal that carries its reason forward, and
a silent socket is neither.
"""

from __future__ import annotations

import importlib.util
import socket
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "probe-sip-registration.py"


def _load():
    spec = importlib.util.spec_from_file_location("probe_sip_registration", _SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


probe = _load()


# ---------------------------------------------------------------------------
# build_register
# ---------------------------------------------------------------------------


def test_build_register_is_a_complete_request_line_and_header_block() -> None:
    msg = probe.build_register("acme.sip.example", "ext101_abc", ("10.0.0.5", 5062))

    assert msg.startswith("REGISTER sip:acme.sip.example SIP/2.0\r\n")
    assert msg.endswith("\r\n\r\n")
    for header in ("Via:", "From:", "To:", "Call-ID:", "CSeq:", "Contact:", "Content-Length:"):
        assert f"\r\n{header}" in msg


def test_build_register_expires_zero_so_a_probe_cannot_steal_the_real_binding() -> None:
    """If an SBC ever accepted this, a live binding would send calls to the probe."""
    msg = probe.build_register("acme.sip.example", "ext101_abc", ("10.0.0.5", 5062))

    assert "\r\nExpires: 0\r\n" in msg


def test_build_register_carries_no_authorization_header() -> None:
    msg = probe.build_register("acme.sip.example", "ext101_abc", ("10.0.0.5", 5062))

    assert "authorization" not in msg.lower()


def test_build_register_advertises_the_local_socket_in_via_and_contact() -> None:
    msg = probe.build_register("acme.sip.example", "ext101_abc", ("10.0.0.5", 5062))

    assert "Via: SIP/2.0/UDP 10.0.0.5:5062;branch=z9hG4bK" in msg
    assert "Contact: <sip:ext101_abc@10.0.0.5:5062>" in msg


def test_build_register_uses_a_fresh_call_id_each_time() -> None:
    """A reused Call-ID/branch would be a retransmission, and answered from cache."""
    first = probe.build_register("acme.sip.example", "ext101_abc", ("10.0.0.5", 5062))
    second = probe.build_register("acme.sip.example", "ext101_abc", ("10.0.0.5", 5062))

    assert first != second


# ---------------------------------------------------------------------------
# parse_response
# ---------------------------------------------------------------------------


def test_parse_response_extracts_status_reason_and_headers() -> None:
    raw = (
        "SIP/2.0 403 Forbidden\r\n"
        "X-Reason: Account has been deactivated\r\n"
        "CSeq: 1 REGISTER\r\n\r\n"
    )

    status, reason, headers = probe.parse_response(raw)

    assert (status, reason) == (403, "Forbidden")
    assert headers["x-reason"] == "Account has been deactivated"
    assert headers["cseq"] == "1 REGISTER"


def test_parse_response_lowercases_header_names() -> None:
    """SIP header names are case-insensitive; callers must not have to guess."""
    raw = "SIP/2.0 401 Unauthorized\r\nWWW-Authenticate: Digest\r\n\r\n"

    status, _, headers = probe.parse_response(raw)

    assert status == 401
    assert headers["www-authenticate"] == "Digest"


def test_parse_response_tolerates_a_bare_lf_response() -> None:
    status, reason, headers = probe.parse_response("SIP/2.0 200 OK\nX-Reason: fine\n\n")

    assert (status, reason, headers["x-reason"]) == (200, "OK", "fine")


def test_parse_response_stops_at_the_blank_line() -> None:
    raw = "SIP/2.0 401 Unauthorized\r\nCSeq: 1 REGISTER\r\n\r\nNot: a header\r\n"

    _, _, headers = probe.parse_response(raw)

    assert "not" not in headers


def test_parse_response_handles_a_missing_reason_phrase() -> None:
    status, reason, _ = probe.parse_response("SIP/2.0 401\r\n\r\n")

    assert (status, reason) == (401, "")


@pytest.mark.parametrize(
    "raw",
    [
        pytest.param("", id="empty"),
        pytest.param("HTTP/1.1 200 OK\r\n\r\n", id="not-sip"),
        pytest.param("SIP/2.0 nope Forbidden\r\n\r\n", id="non-numeric-status"),
        pytest.param("SIP/2.0\r\n\r\n", id="no-status"),
    ],
)
def test_parse_response_rejects_anything_that_is_not_a_sip_response(raw: str) -> None:
    with pytest.raises(probe.ProbeError):
        probe.parse_response(raw)


# ---------------------------------------------------------------------------
# explain
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("status", [401, 407])
def test_explain_treats_a_challenge_as_healthy(status: int) -> None:
    """A probe carries no credentials, so being challenged is the best possible answer."""
    healthy, message = probe.explain(status, "Unauthorized", {})

    assert healthy is True
    assert str(status) in message


def test_explain_reports_403_as_a_refusal_and_quotes_the_x_reason() -> None:
    """The X-Reason is the entire point: a softphone shows this as an unreachable server."""
    healthy, message = probe.explain(403, "Forbidden", {"x-reason": "Account has been deactivated"})

    assert healthy is False
    assert "Account has been deactivated" in message
    assert "not a network or transport problem" in message


def test_explain_handles_403_without_an_x_reason() -> None:
    healthy, message = probe.explain(403, "Forbidden", {})

    assert healthy is False
    assert "()" not in message


def test_explain_points_404_at_the_realm_and_username() -> None:
    healthy, message = probe.explain(404, "Not Found", {})

    assert healthy is False
    assert "sip_username" in message


def test_explain_reports_an_unexpected_status_as_unhealthy() -> None:
    healthy, message = probe.explain(200, "OK", {})

    assert healthy is False
    assert "did not challenge" in message


# ---------------------------------------------------------------------------
# send_register / resolve_host
# ---------------------------------------------------------------------------


def test_send_register_returns_the_raw_reply() -> None:
    sock = MagicMock()
    sock.getsockname.return_value = ("10.0.0.5", 5062)
    sock.recv.return_value = b"SIP/2.0 401 Unauthorized\r\n\r\n"

    with patch.object(probe.socket, "socket", return_value=sock):
        assert probe.send_register("1.2.3.4", 5060, "acme.sip.example", "ext101_abc")

    sock.connect.assert_called_once_with(("1.2.3.4", 5060))
    sock.close.assert_called_once()


def test_send_register_turns_a_timeout_into_a_probe_error_naming_udp() -> None:
    """Silence and refusal are different diagnoses and must not read the same."""
    sock = MagicMock()
    sock.getsockname.return_value = ("10.0.0.5", 5062)
    sock.recv.side_effect = socket.timeout()

    with patch.object(probe.socket, "socket", return_value=sock):
        with pytest.raises(probe.ProbeError, match="UDP is being dropped"):
            probe.send_register("1.2.3.4", 5060, "acme.sip.example", "ext101_abc")

    sock.close.assert_called_once()


def test_send_register_closes_the_socket_when_connect_fails() -> None:
    sock = MagicMock()
    sock.connect.side_effect = OSError("network unreachable")

    with patch.object(probe.socket, "socket", return_value=sock):
        with pytest.raises(probe.ProbeError, match="could not reach"):
            probe.send_register("1.2.3.4", 5060, "acme.sip.example", "ext101_abc")

    sock.close.assert_called_once()


def test_resolve_host_uses_the_injected_resolver() -> None:
    assert probe.resolve_host("acme.sip.example", lambda name: "9.9.9.9") == "9.9.9.9"


def test_resolve_host_reports_a_dns_failure_as_a_probe_error() -> None:
    def boom(name: str) -> str:
        raise OSError("no such host")

    with pytest.raises(probe.ProbeError, match="could not resolve"):
        probe.resolve_host("acme.sip.example", boom)


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def test_main_exits_ok_on_a_challenge(capsys: pytest.CaptureFixture[str]) -> None:
    with (
        patch.object(probe, "resolve_host", return_value="1.2.3.4"),
        patch.object(probe, "send_register", return_value="SIP/2.0 401 Unauthorized\r\n\r\n"),
    ):
        code = probe.main(["--realm", "acme.sip.example", "--user", "ext101_abc"])

    assert code == probe.EXIT_OK
    assert "ext101_abc@acme.sip.example via 1.2.3.4:5060/udp" in capsys.readouterr().out


def test_main_exits_refused_on_a_deactivated_account(capsys: pytest.CaptureFixture[str]) -> None:
    raw = "SIP/2.0 403 Forbidden\r\nX-Reason: Account has been deactivated\r\n\r\n"
    with (
        patch.object(probe, "resolve_host", return_value="1.2.3.4"),
        patch.object(probe, "send_register", return_value=raw),
    ):
        code = probe.main(["--realm", "acme.sip.example", "--user", "ext101_abc"])

    assert code == probe.EXIT_REFUSED
    assert "Account has been deactivated" in capsys.readouterr().out


def test_main_skips_dns_when_host_is_given() -> None:
    with (
        patch.object(probe, "resolve_host") as resolver,
        patch.object(
            probe, "send_register", return_value="SIP/2.0 401 Unauthorized\r\n\r\n"
        ) as sender,
    ):
        probe.main(["--realm", "acme.sip.example", "--user", "u", "--host", "5.6.7.8"])

    resolver.assert_not_called()
    assert sender.call_args[0][0] == "5.6.7.8"


def test_main_reports_a_probe_error_on_stderr(capsys: pytest.CaptureFixture[str]) -> None:
    with patch.object(probe, "resolve_host", side_effect=probe.ProbeError("could not resolve x")):
        code = probe.main(["--realm", "acme.sip.example", "--user", "u"])

    assert code == probe.EXIT_REFUSED
    captured = capsys.readouterr()
    assert "could not resolve x" in captured.err
    assert captured.out == ""


@pytest.mark.parametrize("port", ["0", "65536", "-1"])
def test_main_rejects_a_port_outside_the_valid_range(port: str) -> None:
    with patch.object(probe, "send_register") as sender:
        code = probe.main(["--realm", "acme.sip.example", "--user", "u", "--port", port])

    assert code == probe.EXIT_UNCONFIGURED
    sender.assert_not_called()
