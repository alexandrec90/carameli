#!/usr/bin/env python3
"""Starts ngrok, waits for the tunnel URL, patches .env, and restarts the app container.

The pure `set_env_var` and `extract_https_url` helpers are unit-tested in
`scripts/hooks/tests/test_start_ngrok.py`.
"""

import json
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


def extract_https_url(tunnels_json: dict) -> str | None:
    """Return the first https public_url from an ngrok /api/tunnels payload."""
    for tunnel in tunnels_json.get("tunnels", []):
        if tunnel.get("proto") == "https":
            return tunnel.get("public_url")
    return None


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
    # Kill any existing ngrok process.
    subprocess.run(
        ["taskkill", "/f", "/im", "ngrok.exe"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    time.sleep(1)

    print("Starting ngrok...")
    subprocess.Popen(
        ["ngrok", "http", "8000"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )

    url = poll_tunnel_url()
    if not url:
        print(
            "Could not get ngrok URL after 20s. Is ngrok installed and authenticated?",
            file=sys.stderr,
        )
        return 1

    print(f"Tunnel URL: {url}")
    content = ENV_FILE.read_text(encoding="utf-8")
    for key in WEBHOOK_KEYS:
        content, updated = set_env_var(content, key, url)
        print(f"{'Updated' if updated else 'Added'} {key} in .env")
    ENV_FILE.write_text(content, encoding="utf-8", newline="")

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
