"""The agent-telemetry env block must point at the collector this repo actually runs.

`.claude/settings.json` is the *host* half of the monitoring stack: Claude Code runs on
the host with `CLAUDE_CODE_ENABLE_TELEMETRY=1` and exports OTLP to a port that only
exists because `docker-compose.yml` publishes it from the `otel-collector` service
(`--profile monitoring`). Nothing enforces that pairing at runtime -- an OTLP exporter
whose endpoint refuses the connection retries in the background and Claude Code carries
on, so a port that drifts on either side produces *silent* data loss, not an error.

The file is also the one piece of harness config devkit never vendors (see
`sync-devkit.py`'s `SETTINGS_FILE` comment): the template scaffolds it once and every
later change is this project's own, so `sync-devkit.py --check` will never report it.
That leaves this test as the only thing standing between the two halves.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
SETTINGS_FILE = REPO_ROOT / ".claude" / "settings.json"
COMPOSE_FILE = REPO_ROOT / "docker-compose.yml"
COLLECTOR_CONFIG = REPO_ROOT / "otel-collector-config.yaml"

COLLECTOR_SERVICE = "otel-collector"


def _env() -> dict[str, str]:
    return json.loads(SETTINGS_FILE.read_text(encoding="utf-8")).get("env") or {}


def _collector_service() -> dict:
    data = yaml.safe_load(COMPOSE_FILE.read_text(encoding="utf-8"))
    services = data.get("services") or {}
    assert COLLECTOR_SERVICE in services, (
        f"{COMPOSE_FILE.name} defines no {COLLECTOR_SERVICE!r} service, but "
        f"{SETTINGS_FILE.name} exports telemetry to one"
    )
    return services[COLLECTOR_SERVICE]


def _published_host_ports() -> set[str]:
    """Host-side ports of the collector's short-form `HOST:CONTAINER` mappings."""
    return {str(mapping).split(":")[0] for mapping in _collector_service().get("ports") or []}


def _endpoint_port() -> str:
    endpoint = _env().get("OTEL_EXPORTER_OTLP_ENDPOINT", "")
    assert endpoint, f"{SETTINGS_FILE.name} sets no OTEL_EXPORTER_OTLP_ENDPOINT"
    return endpoint.rsplit(":", 1)[-1].rstrip("/")


def test_telemetry_is_enabled() -> None:
    assert _env().get("CLAUDE_CODE_ENABLE_TELEMETRY") == "1", (
        "the rest of this block, the collector service and its Prometheus/Grafana "
        "consumers are all inert without the flag that makes Claude Code export"
    )


def test_exporter_endpoint_is_published_by_the_collector_service() -> None:
    port = _endpoint_port()
    published = _published_host_ports()
    assert port in published, (
        f"Claude Code exports to host port {port}, which {COLLECTOR_SERVICE} does not "
        f"publish (it publishes {sorted(published)}). Telemetry would be dropped with "
        f"no error on either side."
    )


def test_exporter_protocol_matches_the_receiver_on_that_port() -> None:
    """`http/protobuf` must reach the collector's HTTP receiver, not its gRPC one.

    Both are OTLP and both are published; sending protobuf-over-HTTP at the gRPC port is
    a connection the collector accepts and then fails to parse.
    """
    protocol = _env().get("OTEL_EXPORTER_OTLP_PROTOCOL")
    assert protocol == "http/protobuf", f"unexpected OTLP protocol {protocol!r}"

    receivers = yaml.safe_load(COLLECTOR_CONFIG.read_text(encoding="utf-8"))["receivers"]
    http_endpoint = receivers["otlp"]["protocols"]["http"]["endpoint"]
    container_port = http_endpoint.rsplit(":", 1)[-1]

    forwarded = {
        str(mapping).split(":")[0]
        for mapping in _collector_service().get("ports") or []
        if str(mapping).split(":")[-1] == container_port
    }
    assert _endpoint_port() in forwarded, (
        f"the endpoint port does not reach the collector's HTTP receiver "
        f"({http_endpoint}); {sorted(forwarded)} do"
    )


def test_collector_runs_only_under_the_monitoring_profile() -> None:
    """Guards the cost of the pairing: telemetry must not force the stack to grow.

    If the collector ever became unprofiled it would start with every plain
    `docker compose up`, which is four containers of monitoring nobody asked for.
    """
    assert "monitoring" in set(_collector_service().get("profiles") or []), (
        f"{COLLECTOR_SERVICE} is no longer gated behind the `monitoring` profile"
    )


@pytest.mark.parametrize("key", ["service.name", "service.instance.id", "deployment.environment"])
def test_resource_attributes_identify_the_sender(key: str) -> None:
    """The collector converts resource attributes to Prometheus labels.

    `otel-collector-config.yaml` sets `resource_to_telemetry_conversion.enabled`, so
    these become `service_name` / `service_instance_id` / `deployment_environment` on
    every scraped series. Without them the metrics carry no label saying which repo's
    agent produced them -- fine while one collector is running, unreadable the moment a
    second project exports to it.
    """
    attributes = dict(
        pair.split("=", 1)
        for pair in _env().get("OTEL_RESOURCE_ATTRIBUTES", "").split(",")
        if "=" in pair
    )
    assert attributes.get(key), f"OTEL_RESOURCE_ATTRIBUTES sets no {key}"
