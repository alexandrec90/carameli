"""Tests for scripts/archive-done-todos.py pure archive_todos."""
import pytest
from conftest import load_module

mod = load_module("scripts/archive-done-todos.py")


def test_moves_checked_items_to_done():
    text = (
        "# Todo\n"
        "* [ ] open task\n"
        "* [x] finished task\n"
        "* [X] another done\n"
        "\n"
        "## Done\n"
        "\n"
        "* [x] previously done\n"
    )
    out, moved = mod.archive_todos(text)
    assert moved == 2
    active, _, done = out.partition("## Done")
    assert "* [ ] open task" in active
    assert "* [x] finished task" not in active
    assert "* [x] finished task" in done
    assert "* [X] another done" in done
    assert "* [x] previously done" in done


def test_trailing_blank_lines_trimmed_before_done():
    text = "* [ ] task\n\n\n## Done\n"
    out, _ = mod.archive_todos(text)
    assert "* [ ] task\n\n## Done" in out


def test_no_done_section_raises():
    with pytest.raises(ValueError):
        mod.archive_todos("* [ ] task\n")


def test_idempotent_when_nothing_checked():
    text = "* [ ] a\n\n## Done\n\n* [x] old\n"
    out, moved = mod.archive_todos(text)
    assert moved == 0
    assert "* [x] old" in out
