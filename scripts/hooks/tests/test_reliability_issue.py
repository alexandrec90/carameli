"""Tests for scripts/reliability_issue.py, the weekly summary's issue picker.

The regression this exists for: the weekly workflow searched open issues only, so
closing the standing thread by hand on 2026-10-04 failed the next run with "no
issue found" although the thread still existed. A closed thread must be picked
(and reopened by the workflow); only an issue that exists in no state fails.
"""

import json

from conftest import load_module

reliability_issue = load_module("scripts/reliability_issue.py")

TITLE = reliability_issue.ISSUE_TITLE


def _issue(number: int, state: str = "OPEN", title: str = TITLE, pinned: bool = False) -> dict:
    return {"number": number, "title": title, "state": state, "isPinned": pinned}


# --------------------------------------------------------------------------
# choose_issue
# --------------------------------------------------------------------------


def test_choose_issue_picks_the_open_thread():
    assert reliability_issue.choose_issue([_issue(293)]) == (293, "OPEN")


def test_choose_issue_picks_a_closed_thread_rather_than_failing():
    assert reliability_issue.choose_issue([_issue(293, state="CLOSED", pinned=True)]) == (
        293,
        "CLOSED",
    )


def test_choose_issue_returns_none_when_no_issue_exists():
    assert reliability_issue.choose_issue([]) is None


def test_choose_issue_ignores_titles_that_only_contain_the_words():
    issues = [
        _issue(10, title="Weekly Test Reliability Report is noisy"),
        _issue(11, title="weekly test reliability report"),
    ]
    assert reliability_issue.choose_issue(issues) is None


def test_choose_issue_tolerates_surrounding_whitespace_in_the_title():
    assert reliability_issue.choose_issue([_issue(5, title=f"  {TITLE} ")]) == (5, "OPEN")


def test_choose_issue_prefers_open_over_closed():
    issues = [_issue(100, state="CLOSED", pinned=True), _issue(200)]
    assert reliability_issue.choose_issue(issues) == (200, "OPEN")


def test_choose_issue_prefers_pinned_then_oldest_among_open():
    issues = [_issue(50), _issue(300, pinned=True), _issue(40)]
    assert reliability_issue.choose_issue(issues) == (300, "OPEN")
    assert reliability_issue.choose_issue([_issue(50), _issue(40)]) == (40, "OPEN")


def test_choose_issue_treats_lowercase_state_as_open():
    assert reliability_issue.choose_issue([_issue(7, state="open")]) == (7, "OPEN")


def test_choose_issue_honours_a_custom_title():
    issues = [_issue(1), _issue(2, title="Other")]
    assert reliability_issue.choose_issue(issues, "Other") == (2, "OPEN")


# --------------------------------------------------------------------------
# build_parser / main
# --------------------------------------------------------------------------


def test_build_parser_defaults_to_the_weekly_title():
    parser = reliability_issue.build_parser()
    assert parser.parse_args([]).title == TITLE
    assert parser.parse_args(["--title", "X"]).title == "X"


def test_main_prints_number_and_state(capsys):
    payload = json.dumps([_issue(293, state="CLOSED")])
    assert reliability_issue.main([], stdin_text=payload) == 0
    assert capsys.readouterr().out == "293 CLOSED\n"


def test_main_fails_with_an_annotation_when_no_issue_exists(capsys):
    assert reliability_issue.main([], stdin_text="[]") == 1
    captured = capsys.readouterr()
    assert captured.out == ""
    assert "::error::" in captured.err
    assert TITLE in captured.err


def test_main_treats_empty_input_as_no_issue(capsys):
    assert reliability_issue.main([], stdin_text="") == 1
    assert "::error::" in capsys.readouterr().err


def test_main_fails_on_unparseable_input(capsys):
    assert reliability_issue.main([], stdin_text="not json") == 1
    assert "Could not parse" in capsys.readouterr().err


def test_main_fails_on_a_non_list_payload(capsys):
    assert reliability_issue.main([], stdin_text='{"number": 1}') == 1
    assert "Expected a JSON list" in capsys.readouterr().err


def test_main_accepts_a_title_override(capsys):
    payload = json.dumps([_issue(9, title="Custom")])
    assert reliability_issue.main(["--title", "Custom"], stdin_text=payload) == 0
    assert capsys.readouterr().out == "9 OPEN\n"
