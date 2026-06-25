"""Unit tests for the test-skill artifact writer."""

from conftest import load_module

hook = load_module(".claude/skills/test-skill/write-artifacts.py")


def test_hook_mode_writes_single_artifact(tmp_path):
    written = hook.write_artifacts("hook", tmp_path, "2026-06-19T00:00:00+00:00")
    assert [p.name for p in written] == ["test-skill-hook.txt"]
    assert written[0].read_text().startswith("hello from frontmatter hook at ")


def test_bang_mode_writes_both_artifacts(tmp_path):
    written = hook.write_artifacts("bang", tmp_path, "2026-06-19T00:00:00+00:00")
    names = {p.name for p in written}
    assert names == {"test-skill-bang.txt", "test-skill-sentinel.txt"}
    log_dir = tmp_path / "logs/agent"
    assert (log_dir / "test-skill-bang.txt").read_text().startswith("hello from bang command at ")
    assert (log_dir / "test-skill-sentinel.txt").read_text().startswith("hello from test-skill at ")
