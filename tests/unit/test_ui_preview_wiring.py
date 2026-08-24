"""The UI-only preview's seam must stay parametrized.

`worktree.py preview <ref> --ui` starts only the services named in `.devkit.toml`'s
`[worktree] ui_services` and injects `[worktree.ui_env]` into the box's `.env`. That
only reaches the frontend container because docker-compose.yml routes those env vars
through `${...}` substitution — a hardcoded `VITE_PROXY_TARGET=http://app:8000` (the
original spelling) would silently ignore the injection and leave the box's dev-server
proxying at an `app` container that a `--no-deps` box does not have.

The `-` vs `:-` distinction on VITE_API_BASE_URL is load-bearing: the UI box sets it
to the EMPTY string so the browser talks to the backend through the dev-server proxy
(same origin — the app's CORS allow-list never has to name the box's port), and only
the `${VAR-default}` form lets a set-but-empty value win over the default.
"""

from __future__ import annotations

import tomllib
from pathlib import Path

import yaml

REPO = Path(__file__).resolve().parents[2]


def _frontend_env() -> dict[str, str]:
    """The frontend service's `environment:` list as a name -> value mapping."""
    data = yaml.safe_load((REPO / "docker-compose.yml").read_text(encoding="utf-8"))
    entries = data["services"]["frontend"]["environment"]
    assert isinstance(entries, list), "frontend environment is expected in list form"
    return dict(entry.split("=", 1) for entry in entries)


def _worktree_config() -> dict:
    manifest = tomllib.loads((REPO / ".devkit.toml").read_text(encoding="utf-8"))
    return manifest.get("worktree") or {}


def test_the_proxy_target_is_substituted_not_hardcoded() -> None:
    env = _frontend_env()
    assert env["VITE_PROXY_TARGET"] == "${VITE_PROXY_TARGET:-http://app:8000}"


def test_the_api_base_url_lets_a_set_but_empty_value_win() -> None:
    value = _frontend_env()["VITE_API_BASE_URL"]
    assert value.startswith("${VITE_API_BASE_URL-"), (
        f"got {value!r}; the `-` (not `:-`) form is required so the UI preview's "
        "explicit empty value survives substitution"
    )
    assert "http://localhost:${APP_HOST_PORT:-8000}" in value, (
        "the full-stack default must still track APP_HOST_PORT"
    )


def test_ui_services_name_real_compose_services() -> None:
    worktree = _worktree_config()
    services = worktree.get("ui_services")
    assert services == ["frontend"]
    compose = yaml.safe_load((REPO / "docker-compose.yml").read_text(encoding="utf-8"))
    for name in services:
        assert name in compose["services"], f"ui_services names unknown service {name!r}"


def test_ui_env_routes_the_browser_through_the_dev_proxy() -> None:
    ui_env = _worktree_config().get("ui_env") or {}
    assert ui_env.get("VITE_API_BASE_URL") == "", (
        "the UI box must pin the base URL empty; a non-empty value sends the browser "
        "straight at the donor API from a foreign origin, which its CORS refuses"
    )
    assert ui_env.get("VITE_PROXY_TARGET") == "http://host.docker.internal:${APP_HOST_PORT}", (
        "the proxy must cross the host bridge to the donor's app port; `app:8000` "
        "does not exist on a --no-deps box's network"
    )


def test_every_ui_env_key_is_consumed_by_the_frontend_service() -> None:
    """An injected variable nothing substitutes is a silent no-op — the exact
    failure this file exists to prevent."""
    env = _frontend_env()
    for key in _worktree_config().get("ui_env") or {}:
        assert f"${{{key}" in env.get(key, ""), (
            f"{key} is injected by the UI preview but docker-compose.yml's frontend "
            f"service does not substitute it"
        )
