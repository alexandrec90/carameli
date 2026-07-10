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


def test_exited_zero_is_healthy_in_both_passes():
    # One-shot init services exit 0 on success; neither the health-wait pass nor
    # the final check may flag them, while nonzero exits stay failures.
    entries = _services(
        [
            "carameli-minio-init-1|Exited (0) About an hour ago",
            "carameli-db-1|Exited (1) 5 minutes ago",
        ]
    )
    assert dc.sick_services(entries, up._BROKEN_RE) == ["db"]
    assert dc.sick_services(entries, up._FAILURE_RE) == ["db"]
