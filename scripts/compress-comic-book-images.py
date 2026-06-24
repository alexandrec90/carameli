#!/usr/bin/env python3
"""Compresses the comic-book images via the frontend's compress-images.js.

Notifications are a task-layer concern -- the VS Code task wraps this with
scripts/notify-wrap.py. Do not emit a toast from inside the script.
"""
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
JS_SCRIPT = Path(__file__).resolve().parent / "compress-images.js"
COMIC_BOOK_DIR = REPO_ROOT / "frontend" / "public" / "comic-book"


def main() -> int:
    # Run from the frontend dir so node resolves frontend node_modules.
    return subprocess.run(
        ["node", str(JS_SCRIPT), str(COMIC_BOOK_DIR)],
        cwd=REPO_ROOT / "frontend",
    ).returncode


if __name__ == "__main__":
    sys.exit(main())
