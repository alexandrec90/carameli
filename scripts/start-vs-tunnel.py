#!/usr/bin/env python3
"""Expose the local VanillaLand IIS site through ngrok so remote Carameli can deliver
notifies back to it, then write the resulting URL into `.env.local-e2e`.

This is the *reverse* tunnel. `scripts/start-ngrok.py` publishes Carameli's own API for
provider webhooks; this one publishes VanillaSoft's VoipApi for the inverted topology
described in docs/operations/local-integration-testing.md. They are never both needed on
the same machine.

Without this tunnel, remote Carameli cannot reach `localhost:8021` at all, its notify
retries pile up unposted, and `tests/local_e2e/` skips the reverse-direction tests.

Usage: python scripts/start-vs-tunnel.py [--port 8021] [--app-path /cloudli]
"""

import argparse
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = REPO_ROOT / ".env.local-e2e"

# ngrok's local inspector. Only the first agent on a machine gets 4040; the remote box
# runs its own agent, but that is a different host, so this port is ours.
NGROK_API = "http://127.0.0.1:4040/api/tunnels"

DEFAULT_PORT = 8021
# IIS serves the VoIP receiver as an application under the site root, so the public URL
# must carry that path or every notify 404s. `/voip` is the vendor-neutral alias:
# Carameli answers under /voip/carameli/notify/*, Cloudli under /voip/notify/*. The older
# `/cloudli` alias points at the same application and still works — pass --app-path to
# use it, or whatever a given environment registered.
DEFAULT_APP_PATH = "/voip"

SESSION_LIMIT_HELP = """
ngrok reported a simultaneous-session limit (ERR_NGROK_108).

The free plan allows one agent session per account, and the remote Carameli box is
already using it. Options, cheapest first:

  1. A second free ngrok account (different email) and its authtoken on this machine.
  2. Upgrade the plan to allow concurrent sessions.
  3. Use cloudflared for this side instead - `cloudflared tunnel --url http://localhost:8021`
     needs no account at all. Set VS_PUBLIC_BASE_URL by hand afterwards.
""".strip()


def set_env_var(content: str, key: str, value: str) -> str:
    """Return *content* with ``key`` set to ``value``, updating in place or appending.

    Rewrites rather than appends so repeated runs after a tunnel restart leave one line,
    not a growing pile of stale URLs the loader would resolve inconsistently.
    """
    lines = content.splitlines()
    prefix = f"{key}="
    for index, line in enumerate(lines):
        if line.strip().startswith(prefix):
            lines[index] = f"{key}={value}"
            break
    else:
        lines.append(f"{key}={value}")
    return "\n".join(lines) + "\n"


def public_url_from_tunnels(payload: dict) -> str | None:
    """Pick the https public URL out of an ngrok ``/api/tunnels`` response.

    https only: the notify payloads carry customer phone numbers, and ngrok exposes both
    schemes for one tunnel.
    """
    for tunnel in payload.get("tunnels", []):
        url = tunnel.get("public_url", "")
        if url.startswith("https://"):
            return url
    return None


def wait_for_public_url(timeout_s: float = 30.0, interval_s: float = 1.0) -> str | None:
    """Poll the local inspector until the tunnel is registered, or give up."""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(NGROK_API, timeout=3) as response:
                url = public_url_from_tunnels(json.load(response))
                if url:
                    return url
        except (urllib.error.URLError, OSError, json.JSONDecodeError):
            pass  # agent still starting
        time.sleep(interval_s)
    return None


def already_running() -> str | None:
    """Return the public URL of an agent already running here, if any."""
    try:
        with urllib.request.urlopen(NGROK_API, timeout=2) as response:
            return public_url_from_tunnels(json.load(response))
    except (urllib.error.URLError, OSError, json.JSONDecodeError):
        return None


def start_agent(port: int) -> subprocess.Popen | None:
    """Launch `ngrok http <port>` detached, so this script can exit and leave it up."""
    creation_flags = 0
    if sys.platform == "win32":
        creation_flags = subprocess.CREATE_NEW_CONSOLE  # type: ignore[attr-defined]
    try:
        return subprocess.Popen(
            ["ngrok", "http", str(port)],
            cwd=REPO_ROOT,
            creationflags=creation_flags,
        )
    except FileNotFoundError:
        return None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="local IIS port")
    parser.add_argument(
        "--app-path",
        default=DEFAULT_APP_PATH,
        help="IIS application path for VoipApi (appended to the public URL)",
    )
    args = parser.parse_args(argv)

    print(f"\n=== Carameli VanillaLand Reverse Tunnel ===\nTarget   : localhost:{args.port}")

    url = already_running()
    if url:
        print(f"Reusing the ngrok agent already running on this machine: {url}")
    else:
        if start_agent(args.port) is None:
            print(
                "ngrok is not on PATH. It installs to "
                "%LOCALAPPDATA%\\Microsoft\\WinGet\\Links via `winget install ngrok.ngrok`.",
                file=sys.stderr,
            )
            return 1
        url = wait_for_public_url()

    if not url:
        print(
            "\nngrok started but never registered a tunnel. Check the agent window for "
            "the error.\n",
            file=sys.stderr,
        )
        print(SESSION_LIMIT_HELP, file=sys.stderr)
        return 1

    public_base = url.rstrip("/") + args.app_path

    content = ENV_FILE.read_text(encoding="utf-8") if ENV_FILE.is_file() else ""
    ENV_FILE.write_text(set_env_var(content, "VS_PUBLIC_BASE_URL", public_base), encoding="utf-8")

    print(f"Public   : {public_base}")
    print(f"Wrote VS_PUBLIC_BASE_URL to {ENV_FILE.name}")
    print("\nSet these on the REMOTE Carameli, then restart it:\n")
    print(f"  VANILLASOFT_WEBHOOK_URL={public_base}")
    print("  VANILLASOFT_NOTIFY_PREFIX=carameli/notify")
    print("\nFree ngrok URLs change on every restart — re-run this script after one.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
