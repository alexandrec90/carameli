#!/usr/bin/env python3
"""Provision one demo extension and print softphone-ready SIP registration settings.

Carameli already exposes every piece of this over HTTP, but the pieces are spread
across three endpoints and one of them (``/AccessCheck/AccountData``) deletes the
password after a single read, which makes "get a softphone registered" a fiddly
sequence rather than a command. This script is that command:

    python scripts/provision-softphone.py --vs-customer-id 9001 --extension 101

It creates the customer if it is missing, provisions the extension with a password
*it chooses* (``POST /api/v1/extensions`` accepts one, so the one-time-reveal flow is
never entered), optionally points a DID at it, and prints the four values a SIP client
needs: domain, username, password, and the SIP URI the call engine will dial.

The printed password is the point of the tool, so it goes to stdout and nowhere else.
Nothing here writes to ``logs/`` -- an artifact file holding a live SIP credential is
the one thing this must not leave behind.

Exit codes: 0 provisioned, 1 an API call failed, 2 not configured.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import secrets
import sys
import urllib.error
import urllib.request
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)

EXIT_OK = 0
EXIT_FAILED = 1
EXIT_UNCONFIGURED = 2

# ``CreateExtensionRequest.password`` enforces a 12-character floor; generating below it
# would fail validation at the server rather than here, where the message is useful.
MIN_PASSWORD_LENGTH = 12

VSAPI_PREFIX = "/vsapi/1.0.0"
REST_PREFIX = "/api/v1"

# Jambonz registers SIP clients over UDP by default; a hosted account may also publish
# TCP and TLS. The transport is a client-side choice, not something Carameli stores, so
# it is an argument rather than a field read back from the extension.
TRANSPORTS = ("udp", "tcp", "tls")


class ApiError(RuntimeError):
    """A Carameli API call returned a non-2xx status."""

    def __init__(self, method: str, path: str, status: int, body: str) -> None:
        super().__init__(f"{method} {path} -> {status}: {body}")
        self.method = method
        self.path = path
        self.status = status
        self.body = body


@dataclass(frozen=True)
class SoftphoneAccount:
    """Everything a SIP client needs to register as this extension."""

    extension_number: str
    sip_username: str
    sip_password: str
    sip_domain: str
    transport: str

    @property
    def sip_uri(self) -> str:
        """The URI Carameli hands the call engine when it dials this agent."""
        return f"sip:{self.sip_username}@{self.sip_domain}"


def generate_password(length: int = 20) -> str:
    """Return a URL-safe password of at least ``MIN_PASSWORD_LENGTH`` characters.

    ``token_urlsafe`` counts *bytes*, not characters, and base64 expands them, so the
    requested length is applied to the encoded string instead of trusted from the seed.
    """
    if length < MIN_PASSWORD_LENGTH:
        raise ValueError(f"password length must be >= {MIN_PASSWORD_LENGTH}, got {length}")
    token = ""
    while len(token) < length:
        token += secrets.token_urlsafe(length)
    return token[:length]


def build_extension_body(
    *,
    extension_number: str,
    vs_customer_id: int,
    password: str,
    first_name: str | None = None,
    last_name: str | None = None,
) -> dict[str, Any]:
    """Build the ``POST /api/v1/extensions`` body, omitting unset optional fields.

    The schema is ``extra="forbid"``, so an unused name must be absent rather than
    ``None``.
    """
    body: dict[str, Any] = {
        "extension_number": extension_number,
        "vs_customer_id": vs_customer_id,
        "password": password,
    }
    if first_name:
        body["first_name"] = first_name
    if last_name:
        body["last_name"] = last_name
    return body


def account_from_extension(
    payload: dict[str, Any], *, password: str, transport: str = "udp"
) -> SoftphoneAccount:
    """Turn an ``ExtensionResponse`` plus the password we chose into an account.

    ``sip_domain_sid`` carries the call engine's SIP realm, and a blank one means the
    engine provisioned a client with nowhere to register it -- worth failing on here,
    because the symptom otherwise appears as a softphone that silently never registers.
    """
    domain = str(payload.get("sip_domain_sid") or "")
    username = str(payload.get("sip_username") or "")
    if not domain:
        raise ValueError(
            "extension has no sip_domain_sid; the call engine returned no SIP realm "
            "(check JAMBONZ_BASE_URL / JAMBONZ_ACCOUNT_SID)"
        )
    if not username:
        raise ValueError("extension has no sip_username")
    return SoftphoneAccount(
        extension_number=str(payload.get("extension_number") or ""),
        sip_username=username,
        sip_password=password,
        sip_domain=domain,
        transport=transport,
    )


def render_account(account: SoftphoneAccount, *, did: str | None = None) -> str:
    """Render the settings block an operator types into a SIP client."""
    lines = [
        "",
        "  SIP account for extension " + account.extension_number,
        "  " + "-" * 42,
        f"  Domain / host      {account.sip_domain}",
        f"  Username           {account.sip_username}",
        f"  Auth username      {account.sip_username}",
        f"  Password           {account.sip_password}",
        f"  Transport          {account.transport.upper()}",
        f"  Dialed as          {account.sip_uri}",
    ]
    if did:
        lines.append(f"  Inbound DID        {did}")
    lines += [
        "",
        "  Zoiper: Settings > Accounts > Add > SIP, enter the three values above,",
        "  leave the outbound proxy blank, then confirm the account shows Registered.",
        "",
    ]
    return "\n".join(lines)


class ApiClient:
    """Minimal Bearer-authenticated JSON client for the Carameli API.

    ``opener`` is injectable so the call sequence can be tested without a server; it
    takes a ``urllib.request.Request`` and returns ``(status, body_text)``.
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        *,
        opener: Callable[[urllib.request.Request], tuple[int, str]] | None = None,
        timeout_s: float = 30.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._opener = opener or self._urlopen
        self._timeout_s = timeout_s

    def _urlopen(self, request: urllib.request.Request) -> tuple[int, str]:
        try:
            with urllib.request.urlopen(request, timeout=self._timeout_s) as response:
                return response.status, response.read().decode("utf-8")
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read().decode("utf-8", errors="replace")

    def request(self, method: str, path: str, body: dict[str, Any] | None = None) -> Any:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=data,
            method=method,
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        status, text = self._opener(request)
        if status >= 400:
            raise ApiError(method, path, status, text)
        return json.loads(text) if text else None


def ensure_customer(client: ApiClient, vs_customer_id: int) -> bool:
    """Create the customer if it does not exist. Returns True when one was created.

    A 409 counts as success for the same reason the GET is attempted first: two runs of
    this script against the same demo tenant should be indistinguishable.
    """
    try:
        client.request("GET", f"{VSAPI_PREFIX}/VsCustomer/Get/{vs_customer_id}")
    except ApiError as exc:
        if exc.status != 404:
            raise
    else:
        return False

    try:
        client.request("POST", f"{VSAPI_PREFIX}/VsCustomer/Add", {"vs_customer_id": vs_customer_id})
    except ApiError as exc:
        if exc.status == 409:
            return False
        raise
    return True


def provision_extension(
    client: ApiClient,
    *,
    extension_number: str,
    vs_customer_id: int,
    password: str,
    first_name: str | None = None,
    last_name: str | None = None,
) -> dict[str, Any]:
    """Create the extension and its call-engine SIP client."""
    body = build_extension_body(
        extension_number=extension_number,
        vs_customer_id=vs_customer_id,
        password=password,
        first_name=first_name,
        last_name=last_name,
    )
    result = client.request("POST", f"{REST_PREFIX}/extensions", body)
    if not isinstance(result, dict):
        raise ValueError(f"unexpected extension response type: {type(result).__name__}")
    return result


def attach_did(client: ApiClient, *, vs_customer_id: int, did: str, extension_number: str) -> None:
    """Point an already-provisioned DID at the extension so inbound calls ring it."""
    client.request(
        "POST",
        f"{VSAPI_PREFIX}/AddPointerToExtension",
        {
            "vs_customer_id": vs_customer_id,
            "phone_number": did,
            "extension_number": extension_number,
        },
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Provision a demo extension and print its SIP registration settings.",
    )
    parser.add_argument("--extension", required=True, help="extension number, e.g. 101")
    parser.add_argument("--vs-customer-id", type=int, required=True, help="CRM customer id")
    parser.add_argument(
        "--base-url",
        default=None,
        help="Carameli base URL (default: $CARAMELI_BASE_URL, else http://localhost:8000)",
    )
    parser.add_argument(
        "--api-key",
        default=None,
        help="Bearer key (default: $CARAMELI_API_KEY, else $API_KEY_SECRET)",
    )
    parser.add_argument(
        "--password",
        default=None,
        help="SIP password to set (default: generated; at least 12 characters)",
    )
    parser.add_argument("--first-name", default=None)
    parser.add_argument("--last-name", default=None)
    parser.add_argument(
        "--did",
        default=None,
        help="E.164 DID already added via /PhoneLine/Add, to route inbound to this extension",
    )
    parser.add_argument("--transport", choices=TRANSPORTS, default="udp")
    return parser


def resolve_config(args: argparse.Namespace, environ: dict[str, str]) -> tuple[str, str] | str:
    """Return ``(base_url, api_key)``, or a string explaining what is missing."""
    base_url = args.base_url or environ.get("CARAMELI_BASE_URL") or "http://localhost:8000"
    api_key = args.api_key or environ.get("CARAMELI_API_KEY") or environ.get("API_KEY_SECRET")
    if not api_key:
        return (
            "No API key. Pass --api-key, or set CARAMELI_API_KEY (or API_KEY_SECRET) "
            "to the value of API_KEY_SECRET in the running deployment's environment."
        )
    return base_url, api_key


def main(argv: list[str] | None = None, environ: dict[str, str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    resolved = resolve_config(args, dict(environ if environ is not None else os.environ))
    if isinstance(resolved, str):
        print(resolved, file=sys.stderr)
        return EXIT_UNCONFIGURED
    base_url, api_key = resolved

    password = args.password or generate_password()
    if len(password) < MIN_PASSWORD_LENGTH:
        print(f"--password must be at least {MIN_PASSWORD_LENGTH} characters", file=sys.stderr)
        return EXIT_UNCONFIGURED

    try:
        client = ApiClient(base_url, api_key)
        if ensure_customer(client, args.vs_customer_id):
            print(f"Created customer {args.vs_customer_id}")
        payload = provision_extension(
            client,
            extension_number=args.extension,
            vs_customer_id=args.vs_customer_id,
            password=password,
            first_name=args.first_name,
            last_name=args.last_name,
        )
        account = account_from_extension(payload, password=password, transport=args.transport)
        if args.did:
            attach_did(
                client,
                vs_customer_id=args.vs_customer_id,
                did=args.did,
                extension_number=args.extension,
            )
    except (ApiError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return EXIT_FAILED
    except urllib.error.URLError as exc:
        print(f"Could not reach {base_url}: {exc}", file=sys.stderr)
        return EXIT_FAILED

    print(render_account(account, did=args.did))
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
