"""Tests for scripts/db-upgrade.py: the CLI devkit's fix pass migrates this database by.

Docker is stubbed throughout: `dc.run` answers each Alembic command from a table and
records what it was asked, so the exit codes the pass reads are what is asserted.
"""

import pytest
from conftest import load_module

up = load_module("scripts/db-upgrade.py")


@pytest.fixture
def docker(monkeypatch):
    """The app container up, Alembic answering from `answers`, and every call kept."""
    world = {
        "status": ["Up 3 minutes (healthy)"],
        "answers": {
            "current": (
                ["INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.", "013"],
                0,
            ),
            "heads": (["014 (head)"], 0),
            "upgrade head": (["INFO  [alembic.runtime.migration] Running upgrade 013 -> 014"], 0),
        },
        "ran": [],
        "artifact": [],
    }

    def run(argv):
        verb = argv[-1].split(" alembic ", 1)[1]
        world["ran"].append(verb)
        return world["answers"][verb]

    monkeypatch.setattr(up.dc, "docker_ps", lambda *a, **k: (world["status"], 0, False))
    monkeypatch.setattr(up.dc, "run", run)
    monkeypatch.setattr(up.dc, "write_artifact", lambda name, text: world["artifact"].append(text))
    monkeypatch.setattr(up.dc, "clear_artifact", lambda name: world["artifact"].append(""))
    return world


def test_revisions_reads_ids_and_ignores_alembics_log_lines():
    lines = [
        "INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.",
        "INFO  [alembic.runtime.migration] Will assume transactional DDL.",
        "014 (head)",
        "0a1b2c3d (head) (mergepoint)",
        "",
    ]
    assert up.revisions(lines) == {"014", "0a1b2c3d"}


def test_verdict_is_current_only_on_every_head():
    assert up.verdict({"014"}, {"014"}) == up.CURRENT
    assert up.verdict({"013"}, {"014"}) == up.BEHIND
    assert up.verdict(set(), {"014"}) == up.BEHIND, "an empty database is behind"
    assert up.verdict({"a"}, {"a", "b"}) == up.BEHIND, "one branch of two heads is behind"


def test_check_reports_behind_and_applies_nothing(docker):
    assert up.main(["--check"]) == up.BEHIND
    assert docker["ran"] == ["current", "heads"]


def test_check_reports_current(docker):
    docker["answers"]["current"] = (["014 (head)"], 0)
    assert up.main(["--check"]) == up.CURRENT


def test_a_stopped_app_is_unknown_not_a_failure(docker):
    """The pass reads 2 as "nothing to do until the stack is up"."""
    docker["status"] = []
    assert up.main(["--check"]) == up.UNKNOWN
    assert up.main([]) == up.UNKNOWN
    assert docker["ran"] == []


def test_a_check_alembic_could_not_answer_is_a_failure_with_its_artifact(docker, capsys):
    docker["answers"]["current"] = (["Can't locate revision identified by '015'"], 255)
    assert up.main(["--check"]) == up.FAILED
    assert "Can't locate revision" in docker["artifact"][-1]
    assert capsys.readouterr().err.startswith("error: alembic current exited 255")


def test_upgrade_applies_head_and_clears_the_artifact(docker):
    assert up.main([]) == 0
    assert docker["ran"] == ["upgrade head"]
    assert docker["artifact"] == [""]


def test_a_failed_upgrade_says_so_last_on_stderr(docker, capsys):
    """The pass files the last line on stderr as the cause."""
    docker["answers"]["upgrade head"] = (["DuplicateTable: relation exists"], 1)
    assert up.main([]) == up.FAILED
    err = capsys.readouterr().err.strip().splitlines()
    assert err[-1].startswith("error: alembic upgrade head exited 1")
    assert "DuplicateTable" in docker["artifact"][-1]


@pytest.mark.parametrize(
    ("lines", "expected"),
    [
        (["Up 3 minutes (healthy)"], True),
        (["running"], True),
        (["Exited (1) 2 minutes ago"], False),
        ([], False),
    ],
)
def test_app_running_reads_docker_ps_status_lines(lines, expected):
    assert up.app_running(lines) is expected


def test_check_on_its_own_compares_current_with_heads(docker, capsys):
    assert up.check() == up.BEHIND
    assert capsys.readouterr().out.strip() == "behind head"
    docker["answers"]["heads"] = (["INFO  [alembic] noise", "013 (head)"], 0)
    assert up.check() == up.CURRENT
    assert docker["artifact"][-1] == "", "a clean check clears the artifact"


def test_check_stops_at_a_heads_failure(docker):
    docker["answers"]["heads"] = (["boom"], 1)
    assert up.check() == up.FAILED
    assert docker["ran"] == ["current", "heads"]
    assert "boom" in docker["artifact"][-1]


def test_upgrade_on_its_own_echoes_alembic_and_says_where_it_landed(docker, capsys):
    assert up.upgrade() == 0
    out = capsys.readouterr().out
    assert "Running upgrade 013 -> 014" in out and out.strip().endswith("upgraded to head")


def test_fail_writes_the_artifact_and_names_it_last_on_stderr(docker, capsys):
    assert up.fail("alembic heads exited 4", ["line one"]) == up.FAILED
    assert "alembic heads exited 4" in docker["artifact"][-1]
    assert "line one" in docker["artifact"][-1]
    err = capsys.readouterr().err.strip()
    assert err.startswith("error: alembic heads exited 4 -- details in ")
    assert err.endswith(up.ARTIFACT)
