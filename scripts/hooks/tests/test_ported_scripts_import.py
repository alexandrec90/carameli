"""Import smoke tests for the ported runner scripts.

These scripts are orchestration-heavy (subprocess sequencing) with little pure
logic; importing each one verifies it parses, that its module-level imports
resolve, and that side effects stay behind `if __name__ == '__main__'`.
"""

import pytest
from conftest import load_module

ORCHESTRATION_SCRIPTS = [
    "scripts/docker-up.py",
    "scripts/docker-down.py",
    "scripts/docker-status.py",
    "scripts/docker-migrate.py",
    "scripts/docker-restart-app.py",
    "scripts/docker-restart-engine.py",
    "scripts/docker-prune.py",
    "scripts/docker-fix.py",
    "scripts/run-ci.py",
    "scripts/run-e2e.py",
    "scripts/run-load.py",
    "scripts/run-mutation.py",
    "scripts/start-ngrok.py",
    "scripts/pre-commit.py",
    "scripts/install-pre-commit.py",
    "scripts/extract-log-errors.py",
    "scripts/archive-done-todos.py",
    "scripts/compress-comic-book-images.py",
    "scripts/sync-agents-context.py",
]


@pytest.mark.parametrize("relpath", ORCHESTRATION_SCRIPTS)
def test_script_imports_and_has_main(relpath):
    mod = load_module(relpath)
    assert callable(mod.main)


def test_compress_targets_comic_book_dir():
    mod = load_module("scripts/compress-comic-book-images.py")
    assert mod.COMIC_BOOK_DIR.parts[-3:] == ("frontend", "public", "comic-book")
    assert mod.JS_SCRIPT.name == "compress-images.js"
