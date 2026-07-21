"""Unit tests for the portable Stop hook snapshot logic."""

import io
import sys

from conftest import load_module

hook = load_module("scripts/hooks/stop.py")


class _FakeStdin:
    """Minimal stdin stand-in exposing .buffer/.isatty()/.read() for _read_stdin."""

    def __init__(self, data: bytes, tty: bool = False):
        self.buffer = io.BytesIO(data)
        self._tty = tty

    def isatty(self):
        return self._tty

    def read(self):
        return self.buffer.read().decode("utf-8", "surrogateescape")


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


def test_archive_targets_present_with_transcript():
    payload = '{"transcript_path": "/x/session.jsonl", "cwd": "/repo"}'
    assert hook.archive_targets_present(payload) is True


def test_archive_targets_present_without_transcript():
    assert hook.archive_targets_present('{"cwd": "/repo"}') is False
    assert hook.archive_targets_present('{"transcript_path": ""}') is False


def test_archive_targets_present_rejects_non_object_and_garbage():
    assert hook.archive_targets_present("[1, 2, 3]") is False
    assert hook.archive_targets_present("not json") is False
    assert hook.archive_targets_present("") is False


def test_read_stdin_decodes_utf8_payload(monkeypatch):
    payload = '{"transcript_path": "/x/sesión.jsonl"}'
    monkeypatch.setattr(sys, "stdin", _FakeStdin(payload.encode("utf-8")))
    assert hook._read_stdin() == payload


def test_read_stdin_survives_undecodable_byte(monkeypatch):
    # A lone 0x9d byte is undefined in cp1252 and invalid UTF-8. The reader must
    # not crash on it, and the byte must round-trip back out unchanged when the
    # string is re-encoded for the archive child. Regression for the stop-hook
    # UnicodeEncodeError: 'charmap' codec can't encode character '\udc9d'.
    raw = b'{"transcript_path": "/x/a\x9d.jsonl"}'
    monkeypatch.setattr(sys, "stdin", _FakeStdin(raw))
    result = hook._read_stdin()
    assert result.encode("utf-8", "surrogateescape") == raw


def test_read_stdin_empty_for_tty(monkeypatch):
    monkeypatch.setattr(sys, "stdin", _FakeStdin(b'{"x": 1}', tty=True))
    assert hook._read_stdin() == ""
