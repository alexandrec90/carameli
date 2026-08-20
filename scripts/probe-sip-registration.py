#!/usr/bin/env python3
"""Ask the call engine's SBC, over SIP, why a softphone will or will not register.

A softphone reports registration failure as a retry loop with no reason attached, and
Zoiper in particular reports a refused transport as "NOT FOUND" -- which reads as a
firewall or a wrong port when the server is answering perfectly well and declining.
This sends one unauthenticated REGISTER and prints what came back, including the
``X-Reason`` header jambonz uses to say *why*.

The healthy answer is **401** with a ``WWW-Authenticate`` challenge: the SBC is
reachable on that transport and is asking for credentials, which is as far as a probe
should go. Nothing is registered, and no password is needed or sent.

    python scripts/probe-sip-registration.py --realm carameli.sip.jambonz.cloud \
        --user ext101_3c282263

Exit codes: 0 the SBC challenged (healthy), 1 it refused or did not answer,
2 nothing to probe.
"""

from __future__ import annotations

import argparse
import socket
import sys
import uuid
from typing import Callable

EXIT_OK = 0
EXIT_REFUSED = 1
EXIT_UNCONFIGURED = 2

DEFAULT_PORT = 5060
DEFAULT_TIMEOUT_S = 8.0

# 401/407 mean "the SBC is there and wants credentials", which is the goal of a probe
# that deliberately carries none.
CHALLENGE_STATUSES = frozenset({401, 407})


class ProbeError(Exception):
    """The probe could not be carried out at all (DNS, socket, no reply)."""


def build_register(realm: str, user: str, source: tuple[str, int]) -> str:
    """Return a syntactically complete REGISTER carrying no credentials.

    ``Expires: 0`` is deliberate: even if the SBC were to accept an unauthenticated
    REGISTER, this must not leave a binding behind that steals calls from the real
    phone.
    """
    src_ip, src_port = source
    return (
        f"REGISTER sip:{realm} SIP/2.0\r\n"
        f"Via: SIP/2.0/UDP {src_ip}:{src_port};branch=z9hG4bK{uuid.uuid4().hex[:12]};rport\r\n"
        "Max-Forwards: 70\r\n"
        f"From: <sip:{user}@{realm}>;tag={uuid.uuid4().hex[:8]}\r\n"
        f"To: <sip:{user}@{realm}>\r\n"
        f"Call-ID: {uuid.uuid4().hex}\r\n"
        "CSeq: 1 REGISTER\r\n"
        f"Contact: <sip:{user}@{src_ip}:{src_port}>\r\n"
        "Expires: 0\r\n"
        "User-Agent: carameli-probe\r\n"
        "Content-Length: 0\r\n"
        "\r\n"
    )


def parse_response(raw: str) -> tuple[int, str, dict[str, str]]:
    """Split a SIP response into ``(status, reason, headers)``.

    Header names are lowercased; SIP header names are case-insensitive and no caller
    here should have to guess which casing a given SBC release chose.
    """
    lines = raw.replace("\r\n", "\n").split("\n")
    if not lines or not lines[0].startswith("SIP/2.0"):
        raise ProbeError(f"not a SIP response: {raw[:80]!r}")
    parts = lines[0].split(" ", 2)
    if len(parts) < 2 or not parts[1].isdigit():
        raise ProbeError(f"malformed status line: {lines[0]!r}")
    status = int(parts[1])
    reason = parts[2].strip() if len(parts) > 2 else ""
    headers: dict[str, str] = {}
    for line in lines[1:]:
        if not line.strip():
            break
        name, sep, value = line.partition(":")
        if sep:
            headers[name.strip().lower()] = value.strip()
    return status, reason, headers


def explain(status: int, reason: str, headers: dict[str, str]) -> tuple[bool, str]:
    """Return ``(healthy, message)`` for a parsed response."""
    detail = headers.get("x-reason", "")
    if status in CHALLENGE_STATUSES:
        return True, f"{status} {reason} - the SBC is reachable and challenged for credentials."
    if status == 403:
        suffix = f" ({detail})" if detail else ""
        return False, (
            f"{status} {reason}{suffix} - the SBC answered and refused. This is an account "
            "or credential decision, not a network or transport problem; a softphone will "
            "report it as an unreachable server."
        )
    if status == 404:
        return False, (
            f"{status} {reason} - the SBC does not know this SIP user. Check the realm and "
            "the extension's sip_username."
        )
    suffix = f" ({detail})" if detail else ""
    return False, f"{status} {reason}{suffix} - unexpected; the SBC answered but did not challenge."


def send_register(
    host: str, port: int, realm: str, user: str, timeout: float = DEFAULT_TIMEOUT_S
) -> str:
    """Send one REGISTER over UDP and return the raw response text."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(timeout)
    try:
        sock.connect((host, port))
        sock.send(build_register(realm, user, sock.getsockname()).encode())
        return sock.recv(4096).decode(errors="replace")
    except socket.timeout as exc:
        raise ProbeError(
            f"no reply from {host}:{port} within {timeout:g}s - UDP is being dropped between "
            "here and the SBC, or the SBC is not listening on this port"
        ) from exc
    except OSError as exc:
        raise ProbeError(f"could not reach {host}:{port}: {exc}") from exc
    finally:
        sock.close()


def resolve_host(realm: str, resolver: Callable[[str], str] | None = None) -> str:
    """Resolve the realm to an IPv4 address."""
    resolve = resolver or (lambda name: socket.gethostbyname(name))
    try:
        return resolve(realm)
    except OSError as exc:
        raise ProbeError(f"could not resolve {realm}: {exc}") from exc


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--realm", required=True, help="SIP realm, e.g. acme.sip.jambonz.cloud")
    parser.add_argument("--user", required=True, help="the extension's sip_username")
    parser.add_argument("--host", default=None, help="SBC address (default: resolve --realm)")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT_S)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.port < 1 or args.port > 65535:
        print(f"--port must be 1-65535, got {args.port}", file=sys.stderr)
        return EXIT_UNCONFIGURED
    try:
        host = args.host or resolve_host(args.realm)
        raw = send_register(host, args.port, args.realm, args.user, args.timeout)
        status, reason, headers = parse_response(raw)
    except ProbeError as exc:
        print(str(exc), file=sys.stderr)
        return EXIT_REFUSED
    healthy, message = explain(status, reason, headers)
    print(f"{args.user}@{args.realm} via {host}:{args.port}/udp")
    print(message)
    return EXIT_OK if healthy else EXIT_REFUSED


if __name__ == "__main__":
    raise SystemExit(main())
