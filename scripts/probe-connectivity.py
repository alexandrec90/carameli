#!/usr/bin/env python3
"""Probe which Carameli <-> VanillaSoft communication channels are actually open.

Answers one question before any integration work gets designed: which paths
between this machine and the VanillaSoft host exist. Every probe is **read-only**
-- TCP connects and HTTP GETs, never a POST -- so a run inserts no rows, writes
no log entries on systems we do not own, and leaves nothing to clean up.

Channels probed (each result carries the design decision it settles):

  app-https   HTTPS to the VanillaSoft app     -> notify POSTs; pull-based diagnostics
  app-route   the carameli/notify route        -> has staging deployed the honest receiver?
  sql         TCP 1433 on the SQL Server host  -> direct DB verification / MSSQL MCP
  winrm       TCP 5985/5986                    -> remote Get-WinEvent, no new .NET code
  rpc         TCP 135                          -> legacy remote Event Log read
  smb         TCP 445                          -> file-share access to logs
  ngrok       the local ngrok agent            -> is a reverse path even possible

The reverse direction (VanillaSoft -> Carameli) cannot be probed from this side.
The run ends by printing a one-line PowerShell handshake to run on the
VanillaSoft host, and reports any resulting hit it can see in the ngrok inspector.

Config is read from the environment, falling back to `.env`: `VANILLASOFT_WEBHOOK_URL`
and `VANILLASOFT_NOTIFY_PREFIX` are reused as-is. Probe-only overrides are
`VS_PROBE_HOST` (defaults to the webhook URL's host) and `VS_PROBE_DB_HOST`
(defaults to the app host -- set it when SQL Server lives on a separate box).

Exit code is 1 only when `app-https` is blocked: that is the single channel the
integration cannot work without. Every other channel reports open/blocked as
*information* -- a blocked optional channel is a design input, not a failure.

Artifact: `logs/connectivity-probe.log`, overwritten per run and written on a
clean pass too. Pure helpers are unit-tested in
`scripts/hooks/tests/test_probe_connectivity.py`.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import ssl
import sys
import urllib.error
import urllib.request
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from urllib.parse import urlparse

import script_common
from script_common import PASS, REPO_ROOT, SKIP

ARTIFACT = REPO_ROOT / "logs" / "connectivity-probe.log"
NGROK_INSPECTOR = "http://127.0.0.1:4040/api/requests/http?limit=50"
DEFAULT_TIMEOUT = 6.0

# channel -> (what an open result unlocks, what a blocked result forces).
# This mapping is the point of the script: the raw port state is not the answer,
# the design consequence is.
IMPLICATIONS: dict[str, tuple[str, str]] = {
    "app-https": (
        "Carameli -> VanillaSoft works. Notify POSTs and any pull-based diagnostics "
        "endpoint are viable.",
        "REQUIRED CHANNEL. Nothing in the integration can work without it -- fix this "
        "before designing anything else.",
    ),
    "app-route": (
        "The carameli/notify routes are deployed. Flip VANILLASOFT_NOTIFY_PREFIX to "
        "'carameli/notify' to start using the honest receiver.",
        "Routes not deployed (or the app path is wrong). Keep VANILLASOFT_NOTIFY_PREFIX="
        "'notify' until staging deploys CarameliNotifyController.",
    ),
    "sql": (
        "Direct DB verification is possible: skip the diag read endpoints, and an MSSQL "
        "MCP server becomes viable for 'see the row in Vanilla'.",
        "No direct DB read. VS-side verification needs a read endpoint on the app "
        "(carameli/diag/...) or the VanillaSoft web UI.",
    ),
    "winrm": (
        "Remote Event Log read works: 'Get-WinEvent -ComputerName <host>' replaces the "
        "CarameliDiagnosticsController entirely -- no new .NET code needed.",
        "No WinRM. The Event Log must be surfaced by the app itself (pull-based diag "
        "endpoint) unless rpc below is open.",
    ),
    "rpc": (
        "Legacy remote Event Log read may work ('Get-EventLog -ComputerName'). It also "
        "needs a dynamic high port, so treat this as promising, not proven.",
        "No DCOM/RPC path to the Event Log.",
    ),
    "smb": (
        "File-share access -- check for a readable log directory before writing any code.",
        "No file-share access to logs.",
    ),
    "ngrok": (
        "Local tunnel is up, so the reverse path is testable with the handshake below.",
        "ngrok agent is not running ('python scripts/start-ngrok.py'). The reverse "
        "direction can be neither tested nor used.",
    ),
}


@dataclass
class Probe:
    """One channel's outcome. `open_` drives the status line and the artifact section."""

    name: str
    target: str
    open_: bool
    detail: str
    required: bool = False

    @property
    def implication(self) -> str:
        opened, blocked = IMPLICATIONS.get(self.name, ("", ""))
        return opened if self.open_ else blocked


# --------------------------------------------------------------------------- pure


def parse_dotenv(text: str) -> dict[str, str]:
    """Parse `KEY=VALUE` lines from a .env file. Comments/blanks/malformed lines
    are skipped; surrounding quotes are stripped. Deliberately stdlib-only so the
    probe runs without the venv."""
    values: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def resolve_config(environ: dict[str, str], dotenv: dict[str, str]) -> dict[str, str]:
    """Merge .env under the real environment (the environment wins)."""
    merged = dict(dotenv)
    merged.update({k: v for k, v in environ.items() if v})
    return merged


def host_port_from_url(url: str) -> tuple[str, int]:
    """(host, port) for a URL, defaulting the port by scheme. ('', 0) when unparseable."""
    parsed = urlparse(url if "//" in url else "//" + url, scheme="https")
    host = parsed.hostname or ""
    port = parsed.port or (80 if parsed.scheme == "http" else 443)
    return host, port


def notify_probe_url(base_url: str, prefix: str) -> str:
    """The notify route to GET when checking whether the honest receiver is deployed."""
    return f"{base_url.rstrip('/')}/{prefix.strip('/')}/IncomingCall"


def classify_route_status(status: int | None) -> tuple[bool, str]:
    """Decide whether a GET against the notify route proves the route exists.

    The route is POST-only and sits behind CloudliHeaderAttribute, so an
    unauthenticated GET can never return 200 -- 401/403/405 all mean "the route is
    there", and only 404 means it is not deployed. Pure: this is the one piece of
    inference in the script worth testing directly.
    """
    if status is None:
        return False, "no HTTP response"
    if status == 404:
        return False, "HTTP 404 -- carameli/notify routes not deployed at this app path"
    if status in (401, 403):
        return True, f"HTTP {status} -- route exists; auth attribute rejected the anonymous GET"
    if status == 405:
        return True, "HTTP 405 -- route exists (POST-only), method rejected"
    return True, f"HTTP {status}"


def summarize(probes: list[Probe]) -> tuple[int, int, int]:
    """(open, blocked-required, blocked-optional) counts for the shared Results line."""
    opened = sum(1 for p in probes if p.open_)
    required_blocked = sum(1 for p in probes if not p.open_ and p.required)
    return opened, required_blocked, len(probes) - opened - required_blocked


def build_artifact(probes: list[Probe], now: str) -> str:
    """The parseable artifact. Unlike the lint/test runners this is written even
    when everything passes: a probe's *whole* output is the environment state, so
    'blocked' lines are the deliverable, not noise to be filtered out."""
    lines = [
        "# source: scripts/probe-connectivity.py",
        "# Carameli <-> VanillaSoft channel probe. Read-only: TCP connects and HTTP GETs",
        "# only, so nothing was written to any remote system.",
        f"# generated: {now}",
        "",
    ]
    for section, want_open in (("open", True), ("blocked", False)):
        selected = [p for p in probes if p.open_ is want_open]
        if not selected:
            continue
        lines.append(f"## {section}")
        for probe in selected:
            flag = "open" if probe.open_ else "blocked"
            required = " required=true" if probe.required and not probe.open_ else ""
            lines.append(
                f"[{flag}] channel={probe.name} target={probe.target}{required} "
                f"detail={probe.detail!r}"
            )
            lines.append(f"    -> {probe.implication}")
        lines.append("")
    return "\n".join(lines)


def handshake_command(ngrok_url: str) -> str:
    """The one-liner to run on the VanillaSoft host to prove the reverse path."""
    target = ngrok_url.rstrip("/") if ngrok_url else "https://<your-ngrok-domain>"
    return f"Invoke-WebRequest {target}/health -UseBasicParsing | Select-Object StatusCode"


# ------------------------------------------------------------------------ impure


def tcp_probe(host: str, port: int, timeout: float) -> tuple[bool, str]:
    """Connect and close. Refused vs timed-out is the useful distinction: refused
    means the packet reached a host that said no (no firewall in between), timed
    out means something dropped it silently."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True, f"TCP connect to {host}:{port} succeeded"
    except TimeoutError:
        return False, f"timed out after {timeout}s -- silently dropped (firewall)"
    except ConnectionRefusedError:
        return False, "connection refused -- host reachable, nothing listening on that port"
    except OSError as exc:
        return False, f"{type(exc).__name__}: {exc}"


def http_probe(url: str, timeout: float) -> tuple[int | None, str]:
    """GET a URL, returning (status, detail). Any status counts as reachable."""
    request = urllib.request.Request(
        url, method="GET", headers={"User-Agent": "carameli-connectivity-probe"}
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, f"HTTP {response.status}"
    except urllib.error.HTTPError as exc:
        return exc.code, f"HTTP {exc.code} (server answered)"
    except urllib.error.URLError as exc:
        reason = exc.reason
        if isinstance(reason, ssl.SSLCertVerificationError):
            # Reachable but the cert is untrusted -- a real operational finding
            # (self-signed staging cert), not the same thing as "blocked".
            return None, f"TLS certificate not trusted: {reason}"
        return None, f"{type(reason).__name__}: {reason}"
    except (TimeoutError, OSError) as exc:
        return None, f"{type(exc).__name__}: {exc}"


def ngrok_health_hits(timeout: float = 2.0) -> tuple[bool, str]:
    """Read the local ngrok inspector for /health hits (evidence of the handshake)."""
    try:
        with urllib.request.urlopen(NGROK_INSPECTOR, timeout=timeout) as response:
            payload = json.load(response)
    except Exception as exc:
        return False, f"inspector unreachable ({type(exc).__name__}) -- ngrok agent not running"
    requests = payload.get("requests", []) or []
    hits = [r for r in requests if "/health" in (r.get("request", {}).get("uri", ""))]
    return True, f"{len(requests)} tunneled requests seen, {len(hits)} to /health"


def run_probes(config: dict[str, str], timeout: float) -> list[Probe]:
    """Run every channel probe and return the results in report order."""
    base_url = config.get("VANILLASOFT_WEBHOOK_URL", "").strip()
    if not base_url:
        return []

    app_host, app_port = host_port_from_url(base_url)
    app_host = config.get("VS_PROBE_HOST", "").strip() or app_host
    db_host = config.get("VS_PROBE_DB_HOST", "").strip() or app_host
    prefix = config.get("VANILLASOFT_NOTIFY_PREFIX", "notify").strip() or "notify"

    status, detail = http_probe(base_url, timeout)
    probes = [
        Probe("app-https", f"{app_host}:{app_port}", status is not None, detail, required=True)
    ]

    # The question is whether the *honest receiver* is deployed, so probe its route
    # even while VANILLASOFT_NOTIFY_PREFIX still points at the legacy controller.
    route_prefix = "carameli/notify" if prefix == "notify" else prefix
    route_url = notify_probe_url(base_url, route_prefix)
    route_status, route_detail = http_probe(route_url, timeout)
    deployed, route_reason = classify_route_status(route_status)
    probes.append(Probe("app-route", route_url, deployed, route_reason or route_detail))

    for name, host, port in (
        ("sql", db_host, 1433),
        ("winrm", app_host, 5985),
        ("rpc", app_host, 135),
        ("smb", app_host, 445),
    ):
        opened, detail = tcp_probe(host, port, timeout)
        probes.append(Probe(name, f"{host}:{port}", opened, detail))

    opened, detail = ngrok_health_hits()
    probes.append(Probe("ngrok", "127.0.0.1:4040", opened, detail))
    return probes


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="probe-connectivity.py",
        description="Probe which Carameli <-> VanillaSoft channels are open (read-only).",
    )
    parser.add_argument(
        "--timeout", type=float, default=DEFAULT_TIMEOUT, help="per-probe timeout in seconds"
    )
    parser.add_argument("--json", action="store_true", help="also print results as JSON")
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)

    dotenv_path = REPO_ROOT / ".env"
    dotenv = parse_dotenv(dotenv_path.read_text(encoding="utf-8")) if dotenv_path.exists() else {}
    config = resolve_config(dict(os.environ), dotenv)

    script_common.print_suite_header(
        "Connectivity Probe",
        ARTIFACT,
        [f"Timeout  : {args.timeout}s", "Mode     : read-only (no POSTs, no writes)", ""],
    )

    probes = run_probes(config, args.timeout)
    if not probes:
        return script_common.emit_report(
            noun="PROBE",
            artifact_path=ARTIFACT,
            statuses=[(SKIP, "no VANILLASOFT_WEBHOOK_URL in environment or .env")],
            artifact_text="",
            failed=True,
        )

    statuses = [
        (PASS if p.open_ else SKIP, f"{p.name} -- {'open' if p.open_ else 'blocked'} ({p.target})")
        for p in probes
    ]
    now = datetime.now(UTC).isoformat(timespec="seconds")
    failed = any(p.required and not p.open_ for p in probes)

    if args.json:
        print(json.dumps([asdict(p) for p in probes], indent=2))

    code = script_common.emit_report(
        noun="PROBE",
        artifact_path=ARTIFACT,
        statuses=statuses,
        artifact_text=build_artifact(probes, now),
        failed=failed,
        counts=summarize(probes),
        unit="channels",
    )
    print("To test the reverse path (VanillaSoft -> Carameli), run this on the VS host:")
    print("  " + handshake_command(config.get("NGROK_URL", "")))
    print("then re-run this probe and look for a /health hit on the ngrok channel.\n")
    return code


if __name__ == "__main__":
    raise SystemExit(main())
