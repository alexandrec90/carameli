"""Tests for scripts/run-tests.py pure helpers (testmon selection parsing)."""
from conftest import load_module

rt = load_module("scripts/run-tests.py")


def test_parse_testmon_selection_normal():
    assert rt.parse_testmon_selection("SEL=12 selected|TOT=200 tests collected in 1.2s") == (12, 200)


def test_parse_testmon_selection_zero_selected():
    selected, total = rt.parse_testmon_selection("SEL=0 selected|TOT=200 tests collected")
    assert selected == 0
    assert total == 200


def test_parse_testmon_selection_defaults_when_unparseable():
    # Unknown selection -> 999 (force full run); unknown total -> 1 (no div-by-zero).
    assert rt.parse_testmon_selection("SEL=|TOT=") == (999, 1)


def test_parse_testmon_selection_missing_total_defaults_to_one():
    selected, total = rt.parse_testmon_selection("SEL=5 selected|TOT=garbage")
    assert selected == 5
    assert total == 1
