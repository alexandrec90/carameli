"""Scale and naming policy for comic-book pointer chrome.

The cursor exports are deliberately separate from panel art: browsers display their
raster dimensions directly, and Windows Chromium reliably accepts custom cursor images
only inside a 32px envelope. ``encode-comic-art.py --cursors --force`` consumes this
mapping, so changing one value and rerunning that command is the complete scale workflow.
"""

from __future__ import annotations


CURSOR_MAX_EDGES = {
    "pointer": 26,
    "click": 31,
    "hand-dragger": 24,
    "move": 26,
}


def cursor_names(requested: list[str]) -> list[str]:
    """Explicit cursor masters, or every configured one in display-token order."""
    return requested or list(CURSOR_MAX_EDGES)


def cursor_export_settings(stem: str) -> tuple[str, int]:
    """Export filename and long edge for ``stem``; raises ``KeyError`` if unknown."""
    return f"{stem}-cursor.webp", CURSOR_MAX_EDGES[stem]
