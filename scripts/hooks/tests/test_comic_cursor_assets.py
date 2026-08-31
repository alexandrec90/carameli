"""Tests for the scale and naming policy in ``scripts/comic_cursor_assets.py``."""

import pytest

from scripts import comic_cursor_assets as cca


def test_cursor_names_preserves_an_explicit_subset():
    assert cca.cursor_names(["move"]) == ["move"]


def test_cursor_names_defaults_to_every_configured_master():
    assert cca.cursor_names([]) == list(cca.CURSOR_MAX_EDGES)


def test_cursor_export_settings_names_and_scales_the_raster():
    assert cca.cursor_export_settings("hand-dragger") == ("hand-dragger-cursor.webp", 24)


def test_cursor_export_settings_refuses_an_unknown_master():
    with pytest.raises(KeyError):
        cca.cursor_export_settings("conversation")
