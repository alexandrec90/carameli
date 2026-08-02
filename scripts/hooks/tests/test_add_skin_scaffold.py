from pathlib import Path

import pytest
from conftest import load_module

scaffold = load_module(".claude/skills/add-skin/scripts/scaffold.py")


def test_render_registry_adds_name_loader_and_loading_config():
    source = (scaffold.REPO_ROOT / "frontend/src/skins/registry.ts").read_text(encoding="utf-8")
    rendered = scaffold.render_registry(source, "night-shift")
    assert "'night-shift'] as const" in rendered
    assert "'night-shift': () => import('./night-shift')" in rendered
    assert rendered.count("'night-shift': {") == 1


def test_render_switcher_adds_label():
    source = scaffold.SWITCHER.read_text(encoding="utf-8")
    rendered = scaffold.render_switcher(source, "night-shift", "Night Shift")
    assert "'night-shift': 'Night Shift'" in rendered


def test_scaffold_rejects_non_kebab_name(monkeypatch, tmp_path: Path):
    monkeypatch.setattr(scaffold, "SKINS", tmp_path)
    with pytest.raises(ValueError, match="kebab-case"):
        scaffold.scaffold("Night Shift", "Night Shift", dry_run=True)
