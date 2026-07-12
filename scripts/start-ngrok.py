#!/usr/bin/env python3
"""Starts ngrok, waits for the tunnel URL, patches .env, repoints Telnyx, and restarts the app.

Set ``NGROK_DOMAIN`` (in .env or the environment) to pin a reserved/static ngrok
domain so the tunnel URL never changes — every ngrok account gets one free dev
domain (``<name>.ngrok-free.dev``). With a stable domain you configure Telnyx
once and this script's repoint step becomes a no-op that just confirms it.

When ``TELNYX_API_KEY`` and ``TELNYX_MESSAGING_PROFILE_ID`` are set, the script
also PATCHes the Telnyx messaging profile so inbound SMS / delivery receipts
follow the new URL — no manual portal edit. Without them it prints the URL to
set by hand instead.

The pure `set_env_var`, `extract_https_url`, `get_env_value`, and `build_ngrok_args`
helpers are unit-tested in `scripts/hooks/tests/test_start_ngrok.py`.
"""

import json
import os
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = REPO_ROOT / ".env"
NGROK_API = "http://localhost:4040/api/tunnels"
WEBHOOK_KEYS = ["JAMBONZ_WEBHOOK_BASE_URL", "TELNYX_WEBHOOK_BASE_URL", "NGROK_URL"]


def set_env_var(content: str, key: str, val: str) -> tuple[str, bool]:
    """Update an existing `KEY=...` line or append one. Returns (new_content, updated)."""
    pattern = re.compile(rf"^{re.escape(key)}=.*$", re.MULTILINE)
    if pattern.search(content):
        return pattern.sub(f"{key}={val}", content), True
    return content.rstrip() + f"\n{key}={val}\n", False


def get_env_value(content: str, key: str) -> str:
    """Return the value of `KEY=...` from .env content, or '' if absent/blank.

    The live environment takes precedence over the file so an exported override
    (e.g. a per-shell `NGROK_DOMAIN`) wins.
    """
    env_val = os.environ.get(key)
    if env_val:
        return env_val.strip()
    match = re.search(rf"^{re.escape(key)}=(.*)$", content, re.MULTILINE)
    return match.group(1).strip() if match else ""


def extract_https_url(tunnels_json: dict) -> str | None:
    """Return the first https public_url from an ngrok /api/tunnels payload."""
    for tunnel in tunnels_json.get("tunnels", []):
        if tunnel.get("proto") == "https":
            return tunnel.get("public_url")
    return None


def build_ngrok_args(domain: str = "") -> list[str]:
    """Build the ngrok CLI args, pinning a reserved static domain when configured."""
    args = ["ngrok", "http", "8000"]
    if domain:
        args.append(f"--domain={domain}")
    return args


def push_webhook_to_telnyx(base_url: str, api_key: str, messaging_profile_id: str) -> str | None:
    """PATCH the Telnyx messaging profile to point inbound SMS at ``base_url``.

    Returns the webhook URL that was set, or None when Telnyx credentials are
    absent (dev/CI) so the caller can fall back to a manual-portal instruction.
    The app import is lazy so the pure helpers above stay importable by the
    scripts/hooks tests, which load this file off a path without the app package.
    """
    if not api_key or not messaging_profile_id:
        return None

    import asyncio

    from app.services.providers.carrier.telnyx import TelnyxCarrier

    async def _run() -> str:
        carrier = TelnyxCarrier(
            api_key=api_key,
            webhook_base_url=base_url,
            messaging_profile_id=messaging_profile_id,
        )
        try:
            return await carrier.set_webhook_url()
        finally:
            await carrier.aclose()

    return asyncio.run(_run())


def poll_tunnel_url(attempts: int = 20) -> str | None:
    for i in range(1, attempts + 1):
        time.sleep(1)
        try:
            with urllib.request.urlopen(NGROK_API, timeout=3) as resp:
                url = extract_https_url(json.loads(resp.read().decode("utf-8")))
                if url:
                    return url
        except (OSError, ValueError):
            pass
        print(f"Waiting for tunnel... ({i}/{attempts})")
    return None


def main() -> int:
    content = ENV_FILE.read_text(encoding="utf-8")
    domain = get_env_value(content, "NGROK_DOMAIN")

    # Kill any existing ngrok process.
    subprocess.run(
        ["taskkill", "/f", "/im", "ngrok.exe"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    time.sleep(1)

    if domain:
        print(f"Starting ngrok on reserved domain {domain}...")
    else:
        print("Starting ngrok (ephemeral URL — set NGROK_DOMAIN for a stable one)...")
    subprocess.Popen(
        build_ngrok_args(domain), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )

    url = poll_tunnel_url()
    if not url:
        print(
            "Could not get ngrok URL after 20s. Is ngrok installed and authenticated?",
            file=sys.stderr,
        )
        return 1

    print(f"Tunnel URL: {url}")
    for key in WEBHOOK_KEYS:
        content, updated = set_env_var(content, key, url)
        print(f"{'Updated' if updated else 'Added'} {key} in .env")
    ENV_FILE.write_text(content, encoding="utf-8", newline="")

    # Repoint Telnyx's messaging-profile webhook so inbound SMS + delivery
    # receipts follow the tunnel — no manual portal edit.
    api_key = get_env_value(content, "TELNYX_API_KEY")
    messaging_profile_id = get_env_value(content, "TELNYX_MESSAGING_PROFILE_ID")
    manual_hint = f"Set the messaging-profile webhook to {url}/webhooks/telnyx/sms-inbound by hand."
    try:
        webhook_url = push_webhook_to_telnyx(url, api_key, messaging_profile_id)
    except Exception as exc:  # surface the reason; never abort the container restart
        print(f"WARNING: failed to update Telnyx webhook via API: {exc}", file=sys.stderr)
        print(f"  {manual_hint}")
    else:
        if webhook_url:
            print(f"Telnyx messaging-profile webhook updated & confirmed live -> {webhook_url}")
        else:
            print(f"Skipped Telnyx webhook update (Telnyx credentials not set). {manual_hint}")

    print("Restarting app container...")
    subprocess.run(["docker", "compose", "restart", "app"], cwd=REPO_ROOT)

    print(f"\nDone. Webhook base URL: {url}")
    print("ngrok dashboard: http://localhost:4040")
    print("\nTo run webhook e2e tests:")
    print(
        f"  docker compose exec -e NGROK_URL={url} app pytest tests/integration/test_webhook_e2e.py -v"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
