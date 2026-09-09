"""Tests for scripts/docker-up.py's failure classification and network recovery.

One caveat for whoever adds the next case here: the untested-symbol scanner's corpus for
a module is the *whole text* of every test file naming it, so the `up.main()` call below
counts as a reference to `main` for every module this file mentions. Naming a sibling
script that still owes a `main` test would make its gap read as covered and push someone
to delete a real entry from the debt list. `untested_symbols.module_pattern` has the
detail. Keep the modules named here to the ones actually under test.
"""

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


# --- recovery from a network the daemon lost -------------------------------------

# The daemon's exact wording when a container pins a network that no longer exists.
# Captured from two real incidents, 2026-09-08 and 2026-09-09.
STALE_NETWORK_LINE = (
    "Error response from daemon: failed to set up container networking: "
    "network e0d9af187c8f73d5e2703ea7c37a1afb0f3e0c63a1a28775e9eb9a0514b6c69e not found"
)


def test_stale_network_failure_matches_the_daemon_message():
    assert up.stale_network_failure([STALE_NETWORK_LINE]) is True
    # It has to be found among the ordinary progress chatter that precedes it.
    assert (
        up.stale_network_failure(["Container carameli-db-1  Started", STALE_NETWORK_LINE]) is True
    )
    # Short-form IDs as `docker network ls` prints them.
    assert up.stale_network_failure(["network 19b4b1cd05a9 not found"]) is True


def test_stale_network_failure_ignores_unrelated_up_failures():
    assert up.stale_network_failure([]) is False
    assert up.stale_network_failure(["Container carameli-db-1  Started"]) is False
    assert up.stale_network_failure(["Error: port 5432 already allocated"]) is False
    # A *name* that is not found is Compose failing to create the network, which
    # recreating containers does not fix -- recovering from it would loop.
    assert up.stale_network_failure(["network carameli_default not found"]) is False


def _stub_io(monkeypatch):
    """Silence the artifact writes so a failure asserts rather than hitting the disk.

    Patches the `docker_common` that docker-up.py actually imports, which is the one in
    `sys.modules` rather than the separate `dc` object `load_module` builds above.
    """
    import docker_common

    monkeypatch.setattr(docker_common, "ensure_docker_log_dir", lambda: None)
    monkeypatch.setattr(docker_common, "write_artifact", lambda name, content: None)
    monkeypatch.setattr(docker_common, "clear_artifact", lambda name: None)
    monkeypatch.setattr(up.sys, "argv", ["docker-up.py"])
    return docker_common


def test_up_recovers_a_lost_network_with_force_recreate(monkeypatch):
    # Reversion check: without the retry, `up` returns 1 here and the stack stays down
    # until someone types --force-recreate by hand. Plain `up -d` cannot self-heal --
    # Compose reuses the container and hits the same dead ID it failed on last time.
    docker_common = _stub_io(monkeypatch)
    calls: list[list[str]] = []

    def fake_run(argv, timeout):
        calls.append(list(argv))
        if argv[:4] == ["docker", "compose", "up", "-d"] and "--force-recreate" not in argv:
            return [STALE_NETWORK_LINE], 1, False
        return [], 0, False

    monkeypatch.setattr(docker_common, "run_with_timeout", fake_run)
    monkeypatch.setattr(docker_common, "poll_until", lambda *a, **k: True)
    monkeypatch.setattr(
        docker_common,
        "docker_ps",
        lambda *a, **k: (["carameli-db-1|Up 2 minutes (healthy)"], 0, False),
    )

    assert up.main() == 0
    assert ["docker", "compose", "up", "-d", "--force-recreate"] in calls


def test_up_does_not_force_recreate_on_an_unrelated_failure(monkeypatch):
    # --force-recreate throws away every container, so it must stay scoped to the one
    # fault it repairs rather than becoming the generic retry for any failing `up`.
    docker_common = _stub_io(monkeypatch)
    calls: list[list[str]] = []

    def fake_run(argv, timeout):
        calls.append(list(argv))
        if argv[:4] == ["docker", "compose", "up", "-d"]:
            return ["Error: port 5432 already allocated"], 1, False
        return [], 0, False

    monkeypatch.setattr(docker_common, "run_with_timeout", fake_run)

    assert up.main() == 1
    assert not any("--force-recreate" in c for c in calls)


def test_up_gives_up_after_one_recovery_attempt(monkeypatch):
    # The retry must not become a loop: if --force-recreate also hits a dead network,
    # the daemon is broken in a way this script cannot fix and the run has to report it.
    docker_common = _stub_io(monkeypatch)
    calls: list[list[str]] = []

    def fake_run(argv, timeout):
        calls.append(list(argv))
        if argv[:4] == ["docker", "compose", "up", "-d"]:
            return [STALE_NETWORK_LINE], 1, False
        return [], 0, False

    monkeypatch.setattr(docker_common, "run_with_timeout", fake_run)

    assert up.main() == 1
    assert sum(1 for c in calls if "--force-recreate" in c) == 1
