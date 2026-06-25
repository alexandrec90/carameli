"""Tests for scripts/docker_common.py pure helpers."""

import re

from conftest import load_module

dc = load_module("scripts/docker_common.py")


def test_service_from_container_strips_project_and_replica():
    assert dc.service_from_container("carameli-app-1", "carameli") == "app"
    assert dc.service_from_container("carameli-postgres-2", "carameli") == "postgres"


def test_service_from_container_unmatched_returned_asis():
    assert dc.service_from_container("weird-name", "carameli") == "weird-name"


def test_parse_status_entries():
    lines = ["carameli-app-1|Up 2 minutes (healthy)", "carameli-redis-1|Exited (1)", "garbage"]
    assert dc.parse_status_entries(lines, "carameli") == [
        ("app", "Up 2 minutes (healthy)"),
        ("redis", "Exited (1)"),
    ]


def test_sick_services_default_pattern():
    entries = [("app", "Up (healthy)"), ("redis", "unhealthy"), ("db", "Exited (1)")]
    assert dc.sick_services(entries) == ["redis", "db"]


def test_sick_services_dedupes_preserving_order():
    entries = [("app", "unhealthy"), ("app", "Exited"), ("db", "dead")]
    assert dc.sick_services(entries) == ["app", "db"]


def test_sick_services_custom_pattern():
    entries = [("app", "Created"), ("db", "Up")]
    pattern = re.compile(r"Created", re.IGNORECASE)
    assert dc.sick_services(entries, pattern) == ["app"]


def test_format_artifact_structure():
    out = dc.format_artifact("Header", ["line1", "line2"])
    assert out.startswith("Header\nTimestamp: ")
    assert out.endswith("line1\nline2\n")


def test_project_name_is_lowercase():
    assert dc.project_name() == dc.project_name().lower()
