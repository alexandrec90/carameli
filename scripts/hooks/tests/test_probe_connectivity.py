"""Tests for scripts/probe-connectivity.py (pure helpers + main's arg handling).

The network-touching functions (`tcp_probe`, `http_probe`, `ngrok_health_hits`) are
deliberately not exercised here -- they are thin wrappers over stdlib socket/urllib
calls, and faking them would test the fake. Everything that carries a *decision*
(route classification, config precedence, artifact shape) is pure and tested below.
"""

import pytest
from conftest import load_module

mod = load_module("scripts/probe-connectivity.py")


# ------------------------------------------------------------------- parse_dotenv


def test_parse_dotenv_reads_simple_pairs():
    parsed = mod.parse_dotenv("FOO=bar\nBAZ=qux\n")
    assert parsed == {"FOO": "bar", "BAZ": "qux"}


def test_parse_dotenv_skips_comments_blanks_and_malformed_lines():
    parsed = mod.parse_dotenv("# a comment\n\nGOOD=1\nnot-a-pair\n   \n")
    assert parsed == {"GOOD": "1"}


@pytest.mark.parametrize("raw", ['URL="https://x/"', "URL='https://x/'"])
def test_parse_dotenv_strips_matching_quotes(raw):
    assert mod.parse_dotenv(raw) == {"URL": "https://x/"}


def test_parse_dotenv_keeps_value_containing_equals():
    # Secrets and connection strings routinely contain '='; partition() must not split twice.
    # pragma below: detect-secrets flags the SECRET= keyword, but "a=b=c" is the literal
    # fixture that makes the point -- there is no credential here to move somewhere safer.
    assert mod.parse_dotenv("SECRET=a=b=c") == {"SECRET": "a=b=c"}  # pragma: allowlist secret


# ----------------------------------------------------------------- resolve_config


def test_resolve_config_environment_overrides_dotenv():
    merged = mod.resolve_config({"K": "from-env"}, {"K": "from-dotenv", "ONLY": "d"})
    assert merged == {"K": "from-env", "ONLY": "d"}


def test_resolve_config_ignores_empty_environment_values():
    # An exported-but-empty var must not blank out a real .env value.
    merged = mod.resolve_config({"K": ""}, {"K": "from-dotenv"})
    assert merged["K"] == "from-dotenv"


# ------------------------------------------------------------- host_port_from_url


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("https://wwac.crm.org/api", ("wwac.crm.org", 443)),
        ("http://box.local/app", ("box.local", 80)),
        ("https://box.local:8443/app", ("box.local", 8443)),
        ("wwac.crm.org", ("wwac.crm.org", 443)),
    ],
)
def test_host_port_from_url(url, expected):
    assert mod.host_port_from_url(url) == expected


def test_host_port_from_url_handles_unparseable_input():
    host, port = mod.host_port_from_url("")
    assert host == ""
    assert port == 443


# ------------------------------------------------------------- notify_probe_url


@pytest.mark.parametrize("base", ["https://h/voip", "https://h/voip/"])
def test_notify_probe_url_normalizes_slashes(base):
    assert (
        mod.notify_probe_url(base, "carameli/notify")
        == "https://h/voip/carameli/notify/IncomingCall"
    )


def test_notify_probe_url_strips_prefix_slashes():
    assert mod.notify_probe_url("https://h", "/notify/") == "https://h/notify/IncomingCall"


# -------------------------------------------------------- classify_route_status


@pytest.mark.parametrize("status", [401, 403, 405])
def test_classify_route_status_treats_auth_and_method_rejections_as_deployed(status):
    """A POST-only route behind an auth attribute can never answer 200 to an
    anonymous GET, so these codes are the *positive* signal."""
    deployed, reason = mod.classify_route_status(status)
    assert deployed is True
    assert str(status) in reason


def test_classify_route_status_404_means_not_deployed():
    deployed, reason = mod.classify_route_status(404)
    assert deployed is False
    assert "not deployed" in reason


def test_classify_route_status_none_means_no_response():
    deployed, reason = mod.classify_route_status(None)
    assert deployed is False
    assert reason == "no HTTP response"


def test_classify_route_status_unexpected_code_is_reported_verbatim():
    deployed, reason = mod.classify_route_status(500)
    assert deployed is True
    assert "500" in reason


# ------------------------------------------------------------------- Probe model


def test_probe_implication_switches_on_open_state():
    opened = mod.Probe("winrm", "h:5985", True, "ok")
    blocked = mod.Probe("winrm", "h:5985", False, "timed out")
    assert "Get-WinEvent" in opened.implication
    assert opened.implication != blocked.implication
    assert blocked.implication


def test_probe_implication_is_empty_for_unknown_channel():
    assert mod.Probe("mystery", "h:1", True, "ok").implication == ""


# --------------------------------------------------------------------- summarize


def test_summarize_splits_required_and_optional_blocks():
    probes = [
        mod.Probe("app-https", "h:443", False, "x", required=True),
        mod.Probe("sql", "h:1433", True, "x"),
        mod.Probe("winrm", "h:5985", False, "x"),
    ]
    assert mod.summarize(probes) == (1, 1, 1)


# ---------------------------------------------------------------- build_artifact


def _artifact(probes):
    return mod.build_artifact(probes, "2026-07-31T00:00:00+00:00")


def test_build_artifact_has_source_header_and_timestamp():
    text = _artifact([mod.Probe("sql", "h:1433", True, "ok")])
    assert text.startswith("# source: scripts/probe-connectivity.py")
    assert "# generated: 2026-07-31T00:00:00+00:00" in text
    assert "GETs may appear in remote access logs" in text


def test_build_artifact_groups_open_and_blocked_sections():
    text = _artifact(
        [
            mod.Probe("sql", "h:1433", True, "connected"),
            mod.Probe("winrm", "h:5985", False, "timed out"),
        ]
    )
    assert "## open" in text
    assert "## blocked" in text
    assert text.index("## open") < text.index("## blocked")


def test_build_artifact_line_is_self_contained():
    """diagnostics.md rule 1: every line must be actionable in isolation -- channel,
    target and detail all present, with the design implication on the next line."""
    text = _artifact([mod.Probe("winrm", "box:5985", False, "timed out after 6.0s")])
    assert "[blocked] channel=winrm target=box:5985" in text
    assert "timed out after 6.0s" in text
    assert "    -> " in text


def test_build_artifact_flags_a_blocked_required_channel():
    text = _artifact([mod.Probe("app-https", "h:443", False, "timeout", required=True)])
    assert "required=true" in text


def test_build_artifact_omits_an_empty_section():
    text = _artifact([mod.Probe("sql", "h:1433", True, "ok")])
    assert "## blocked" not in text


# ----------------------------------------------------------- handshake_command


def test_handshake_command_uses_the_configured_ngrok_url():
    assert "https://x.ngrok.app/health" in mod.handshake_command("https://x.ngrok.app/")


def test_handshake_command_falls_back_to_a_placeholder():
    assert "<your-ngrok-domain>" in mod.handshake_command("")


# ------------------------------------------------------------------ run_probes


def test_run_probes_returns_nothing_without_a_webhook_url():
    assert mod.run_probes({}, timeout=0.01) == []


# ------------------------------------------------------------------------ main


def test_main_rejects_an_unknown_argument():
    """tooling.md: an unrecognized arg must exit 2, never fall through to the run."""
    with pytest.raises(SystemExit) as excinfo:
        mod.main(["--bogus"])
    assert excinfo.value.code == 2


def test_main_help_exits_zero():
    with pytest.raises(SystemExit) as excinfo:
        mod.main(["--help"])
    assert excinfo.value.code == 0
