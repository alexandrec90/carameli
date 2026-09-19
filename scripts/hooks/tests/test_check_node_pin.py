"""Tests for scripts/check-node-pin.py -- when the pin is out of support, and when a
newer LTS is safe to propose.

Every test injects a schedule and a date. The real one is a network fetch whose contents
change under us, and a test that asserted "24 is LTS" would start failing in 2028 for a
reason having nothing to do with this code.
"""

import datetime as dt

from conftest import load_module

check = load_module("scripts/check-node-pin.py")
node_pin = load_module("scripts/node_pin.py")

TODAY = dt.date(2026, 9, 18)

# Shaped like nodejs/Release's schedule.json. 25 is the trap: released, current, and
# never LTS -- the line Dependabot would happily offer.
SCHEDULE = {
    "v20": {"start": "2023-04-18", "lts": "2023-10-24", "end": "2026-04-30"},
    "v22": {"start": "2024-04-24", "lts": "2024-10-29", "end": "2027-04-30"},
    "v24": {"start": "2025-04-22", "lts": "2025-10-28", "end": "2028-04-30"},
    "v25": {"start": "2025-10-14", "end": "2026-06-01"},
    "v26": {"start": "2026-04-21", "lts": "2026-10-27", "end": "2029-04-30"},
}


def test_only_lines_that_have_entered_lts_count():
    """25 has no `lts` date at all and 26 has not reached its yet. Both are current
    releases with months to live; proposing either is proposing to do this again."""
    assert check.lts_lines(SCHEDULE, TODAY) == [22, 24]


def test_a_line_counts_once_its_lts_date_arrives():
    assert 26 in check.lts_lines(SCHEDULE, dt.date(2026, 10, 28))


def test_an_expired_line_stops_counting():
    assert 20 not in check.lts_lines(SCHEDULE, TODAY)


def test_support_is_read_from_the_end_date():
    assert not check.is_supported(SCHEDULE, 20, TODAY)
    assert check.is_supported(SCHEDULE, 24, TODAY)


def test_an_unknown_line_is_assumed_supported():
    """A line this schedule has never heard of means our copy is stale, not that the
    runtime is dead. Failing the gate over our own ignorance is the wrong direction."""
    assert check.is_supported(SCHEDULE, 99, TODAY)


def test_an_eol_pin_is_a_failure_not_a_notice():
    found, code = check.findings(SCHEDULE, 20, [], TODAY)

    assert code == 1
    assert any("NODE_PIN_EOL" in line for line in found)
    assert any("2026-04-30" in line for line in found)


def test_a_current_pin_on_the_newest_admissible_lts_says_nothing():
    found, code = check.findings(SCHEDULE, 24, [], TODAY)

    assert (found, code) == ([], 0)


def test_a_newer_lts_is_proposed_only_when_the_lock_admits_it():
    """The whole safety property. 26 is LTS on this date, but a package flooring at
    `<26` means the tree cannot run there, so it is not offered."""
    blocked = [("some-pkg", ">=22.18.0 <26.0.0")]
    later = dt.date(2026, 10, 28)

    assert check.recommend(SCHEDULE, 24, blocked, later) is None
    assert check.recommend(SCHEDULE, 24, [("some-pkg", ">=22.18.0")], later) == 26


def test_a_proposal_is_a_notice_and_never_fails_the_run():
    found, code = check.findings(SCHEDULE, 24, [("p", ">=22")], dt.date(2026, 10, 28))

    assert code == 0
    assert any("NODE_PIN_BEHIND" in line for line in found)


def test_a_proposal_names_what_held_back_the_newer_lines():
    """Proposing 22 while 24 exists is confusing unless it says why, and "why" is a
    package name the reader can go and look at."""
    constraints = [("stuck-pkg", "^22.13.0")]

    found, _ = check.findings(SCHEDULE, 20, constraints, TODAY)
    behind = [line for line in found if "NODE_PIN_BEHIND" in line]

    assert behind and "stuck-pkg" in behind[0]


def test_both_findings_can_appear_at_once():
    found, code = check.findings(SCHEDULE, 20, [("p", ">=18")], TODAY)

    assert code == 1
    assert len(found) == 2


def test_an_unreachable_schedule_is_not_a_finding(monkeypatch, capsys):
    """An offline laptop asked no question. Reporting that as "your Node is fine" and
    reporting it as a failure are both false; the default is the quiet one, and
    --offline-exit is there for a caller that would rather know."""
    monkeypatch.setattr(check, "fetch_schedule", lambda *a, **k: {})

    assert check.main([]) == 0
    assert "not checked" in capsys.readouterr().out
    assert check.main(["--offline-exit", "1"]) == 1


def test_fetch_returns_empty_rather_than_raising_when_the_network_is_gone(monkeypatch):
    def explode(*args, **kwargs):
        raise OSError("no route to host")

    monkeypatch.setattr(check.urllib.request, "urlopen", explode)
    assert check.fetch_schedule() == {}


def test_the_artifact_names_the_three_files_that_move_together():
    text = check.artifact_text([".nvmrc:1:1: NODE_PIN_EOL: whatever"])

    assert ".nvmrc" in text
    assert "setup-node-env" in text
    assert "docker-compose.yml" in text
    assert check.artifact_text([]) == ""


def test_the_real_repo_pin_is_readable_without_the_network():
    """`check-node-pin.py` reads the pin and the lock locally and only the schedule
    remotely, so everything but the release dates is testable here."""
    assert node_pin.pinned_major() >= 20
    assert node_pin.engine_constraints()
