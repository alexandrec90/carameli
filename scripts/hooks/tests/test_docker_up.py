"""Tests for scripts/docker-up.py failure-classification regexes."""
from conftest import load_module

dc = load_module("scripts/docker_common.py")
up = load_module("scripts/docker-up.py")


def _services(lines):
    return dc.parse_status_entries(lines, "carameli")


def test_broken_excludes_created():
    entries = _services(["carameli-app-1|Created", "carameli-db-1|unhealthy"])
    # _BROKEN_RE (the health-wait pass) does NOT count Created as broken.
    assert dc.sick_services(entries, up._BROKEN_RE) == ["db"]


def test_starting_matches_created():
    entries = _services(["carameli-app-1|Created"])
    assert any(up._STARTING_RE.search(s) for _, s in entries)


def test_failure_re_includes_created():
    entries = _services(["carameli-app-1|Created", "carameli-db-1|Up (healthy)"])
    # The final check DOES treat Created as a failure.
    assert dc.sick_services(entries, up._FAILURE_RE) == ["app"]
