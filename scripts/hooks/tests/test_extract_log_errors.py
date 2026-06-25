"""Tests for scripts/extract-log-errors.py pure parsing/filtering."""

from conftest import load_module

mod = load_module("scripts/extract-log-errors.py")


def test_parse_log_collects_error_and_warning():
    lines = [
        "2026-06-24 10:00:00.000 | ERROR    | app.x:1 - boom",
        "2026-06-24 10:00:01.000 | WARNING  | app.y:2 - careful",
        "2026-06-24 10:00:02.000 | INFO     | app.z:3 - fine",
    ]
    entries = mod.parse_log(lines, set())
    assert len(entries) == 2
    assert entries[0]["timestamp"] == "2026-06-24 10:00:00.000"


def test_parse_log_dedupes_across_calls():
    seen = set()
    a = ["2026-06-24 10:00:00.000 | ERROR    | app.x:1 - boom"]
    b = ["2026-06-24 11:00:00.000 | ERROR    | app.x:1 - boom"]  # same message, later time
    assert len(mod.parse_log(a, seen)) == 1
    assert len(mod.parse_log(b, seen)) == 0  # deduped by message


def test_filter_traceback_keeps_app_frames_drops_third_party():
    raw = [
        "  Traceback (most recent call last):",
        '    File "/usr/lib/python/site-packages/x.py", line 5, in f',
        "      do_thing()",
        '    File "/app/services/foo.py", line 9, in g',
        "      raise ValueError('bad')",
        "ValueError: bad",
    ]
    out = mod.filter_traceback(raw)
    blob = "\n".join(out)
    assert "/app/services/foo.py" in blob
    assert "site-packages/x.py" not in blob
    assert "ValueError: bad" in blob


def test_filter_window_keeps_recent():
    entries = [
        {"timestamp": "2026-06-20 00:00:00.000", "lines": ["old"]},
        {"timestamp": "2026-06-24 00:00:00.000", "lines": ["new"]},
    ]
    out = mod.filter_window(entries, window_days=3)
    assert {e["lines"][0] for e in out} == {"new"}


def test_flatten_sorts_chronologically():
    entries = [
        {"timestamp": "2026-06-24 02:00:00.000", "lines": ["b"]},
        {"timestamp": "2026-06-24 01:00:00.000", "lines": ["a"]},
    ]
    assert mod.flatten(entries) == ["a", "b"]
