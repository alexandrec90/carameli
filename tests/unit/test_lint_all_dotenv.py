"""Unit coverage for ``lint-all.py``'s dotenv file selection.

Regression guard for a failure mode with a nasty shape: ``t_dotenv`` used to glob every
root-level ``.env*``, which includes the git-ignored per-machine files. Configuring
``.env.local-e2e`` to run the local integration suite therefore made
``python scripts/lint-all.py`` fail with eight ``UnorderedKey`` findings in a file no one
else will ever see and CI never reads — so the machines best set up to test the
integration were the ones that could not get a green lint run.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "lint-all.py"


def _load_script() -> Any:
    spec = importlib.util.spec_from_file_location("lint_all_script", SCRIPT_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    # `lint-all.py` imports its siblings (`diagnostics`, `script_common`) as top-level
    # modules, which only resolves when `scripts/` is importable.
    sys.path.insert(0, str(SCRIPT_PATH.parent))
    try:
        spec.loader.exec_module(module)
    finally:
        sys.path.remove(str(SCRIPT_PATH.parent))
    return module


script = _load_script()


class TestTrackedDotenvFiles:
    def _make(self, root: Path, *names: str) -> None:
        for name in names:
            (root / name).write_text("A=1\n", encoding="utf-8")

    def test_selects_the_committed_templates(self, tmp_path: Path) -> None:
        self._make(tmp_path, ".env.example", ".env.local-e2e.example")
        tracked = {".env.example", ".env.local-e2e.example"}
        assert script.tracked_dotenv_files(tmp_path, tracked) == [
            ".env.example",
            ".env.local-e2e.example",
        ]

    def test_skips_the_git_ignored_per_machine_files(self, tmp_path: Path) -> None:
        """The whole point: a configured machine must still lint clean."""
        self._make(tmp_path, ".env", ".env.local-e2e", ".env.example")
        assert script.tracked_dotenv_files(tmp_path, {".env.example"}) == [".env.example"]

    def test_returns_nothing_when_no_template_is_tracked(self, tmp_path: Path) -> None:
        """An empty list makes ``t_dotenv`` skip cleanly rather than lint the ignored ones."""
        self._make(tmp_path, ".env", ".env.local-e2e")
        assert script.tracked_dotenv_files(tmp_path, set()) == []

    def test_ignores_directories_named_like_dotenv_files(self, tmp_path: Path) -> None:
        (tmp_path / ".envrc.d").mkdir()
        self._make(tmp_path, ".env.example")
        assert script.tracked_dotenv_files(tmp_path, {".env.example", ".envrc.d"}) == [
            ".env.example"
        ]

    def test_this_repos_templates_are_selected(self) -> None:
        """Guards the other direction: the fix must not stop linting anything real."""
        selected = script.tracked_dotenv_files(REPO_ROOT, script._git_tracked_root_files())
        assert ".env.example" in selected
        assert ".env.local-e2e.example" in selected
        assert ".env" not in selected
