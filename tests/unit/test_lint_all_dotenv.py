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


class TestDotenvSelectionWithoutGit:
    """``None`` means nobody looked, and must not read as "nothing to lint".

    ``scripts/run-tests.py`` runs pytest inside the app container, which ships no
    git — so this was every containerised run, and it linted nothing while
    reporting success.
    """

    def _make(self, root: Path, *names: str) -> None:
        for name in names:
            (root / name).write_text("A=1\n", encoding="utf-8")

    def test_falls_back_to_the_example_templates(self, tmp_path: Path) -> None:
        self._make(tmp_path, ".env", ".env.local-e2e", ".env.example", ".env.local-e2e.example")
        assert script.tracked_dotenv_files(tmp_path, None) == [
            ".env.example",
            ".env.local-e2e.example",
        ]

    def test_the_fallback_still_skips_per_machine_files(self, tmp_path: Path) -> None:
        """The reason the git filter existed survives losing git."""
        self._make(tmp_path, ".env", ".env.local-e2e")
        assert script.tracked_dotenv_files(tmp_path, None) == []

    def test_an_empty_set_is_not_the_same_as_none(self, tmp_path: Path) -> None:
        """An empty set is git answering "nothing tracked" — honour it literally."""
        self._make(tmp_path, ".env.example")
        assert script.tracked_dotenv_files(tmp_path, set()) == []
        assert script.tracked_dotenv_files(tmp_path, None) == [".env.example"]

    def test_the_fallback_ignores_directories(self, tmp_path: Path) -> None:
        (tmp_path / ".env.d.example").mkdir()
        self._make(tmp_path, ".env.example")
        assert script.tracked_dotenv_files(tmp_path, None) == [".env.example"]

    def test_missing_git_reports_none_rather_than_an_empty_set(self, monkeypatch: Any) -> None:
        """The producer half: an OSError must not be flattened into "nothing tracked"."""

        def _boom(*_args: Any, **_kwargs: Any) -> Any:
            raise OSError("git: not found")

        monkeypatch.setattr(script.subprocess, "run", _boom)
        assert script._git_tracked_root_files() is None
