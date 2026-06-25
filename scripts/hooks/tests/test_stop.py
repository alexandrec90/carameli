"""Unit tests for the portable Stop hook snapshot logic."""

from conftest import load_module

hook = load_module("scripts/hooks/stop.py")


def test_no_profile_is_noop(tmp_path):
    profile = tmp_path / "skills-profile.json"
    snapshot = tmp_path / "skills-profile.optimized.json"
    assert hook.save_snapshot(profile, snapshot) == 0
    assert not snapshot.exists()


def test_profile_present_saves_snapshot(tmp_path):
    profile = tmp_path / "skills-profile.json"
    snapshot = tmp_path / "skills-profile.optimized.json"
    profile.write_text('{"fix-tests": {"invocations": 3}}')

    assert hook.save_snapshot(profile, snapshot) == 0
    assert snapshot.exists()
    assert snapshot.read_text() == profile.read_text()


def test_snapshot_overwrites_previous(tmp_path):
    profile = tmp_path / "skills-profile.json"
    snapshot = tmp_path / "skills-profile.optimized.json"
    snapshot.write_text('{"stale": true}')
    profile.write_text('{"fresh": true}')

    assert hook.save_snapshot(profile, snapshot) == 0
    assert snapshot.read_text() == '{"fresh": true}'


def test_copy_failure_returns_one(tmp_path):
    profile = tmp_path / "skills-profile.json"
    profile.write_text("{}")
    # Destination directory does not exist -> shutil.copy2 raises OSError
    snapshot = tmp_path / "missing-dir" / "snap.json"

    assert hook.save_snapshot(profile, snapshot) == 1


def test_should_normalize_requires_opt_in():
    assert hook.should_normalize({"CARAMELI_NORMALIZE_KNOWN_FIXES_ON_STOP": "1"}) is True
    assert hook.should_normalize({"CARAMELI_NORMALIZE_KNOWN_FIXES_ON_STOP": "0"}) is False
    assert hook.should_normalize({}) is False


def test_skin_changed_detects_porcelain_lines():
    assert hook.skin_changed(" M frontend/src/skins/carameli/Tile.tsx\n") is True
    assert hook.skin_changed("") is False
    assert hook.skin_changed("\n  \n") is False


def test_finalize_targets_cover_state_driven_skills():
    skills = {skill for skill, _ in hook.FINALIZE_TARGETS}
    assert skills == {"audit-design-flaws", "make-tests", "make-frontend-tests", "refactor"}
