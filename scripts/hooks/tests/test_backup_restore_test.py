"""Tests for scripts/backup_restore_test.py."""

from pathlib import Path

import pytest
from conftest import load_module

mod = load_module("scripts/backup_restore_test.py")


def _listing(*keys):
    return "\n".join(f'{{"status":"success","type":"file","key":"{key}"}}' for key in keys)


def test_parse_args_uses_safe_defaults():
    args = mod.parse_args([])
    assert args.bucket == "carameli-backups"
    assert args.database == "carameli_restore_test"


def test_parse_args_rejects_live_database():
    with pytest.raises(SystemExit) as exc_info:
        mod.parse_args(["--database", "carameli"])
    assert exc_info.value.code == 2


def test_select_newest_dump_ignores_unrelated_objects():
    listing = _listing(
        "notes.txt",
        "carameli-20260717T010000Z.dump",
        "carameli-20260718T010000Z.dump",
    )
    assert mod.select_newest_dump(listing) == "carameli-20260718T010000Z.dump"


def test_select_newest_dump_fails_when_bucket_has_no_dump():
    with pytest.raises(ValueError, match="no carameli"):
        mod.select_newest_dump(_listing("notes.txt"))


def test_parse_call_event_count_accepts_zero():
    assert mod.parse_call_event_count(" 0\n") == 0


def test_parse_call_event_count_rejects_non_numeric_output():
    with pytest.raises(ValueError, match="unexpected"):
        mod.parse_call_event_count("ERROR")


def test_restore_latest_runs_restore_query_and_cleanup():
    calls = []
    downloaded = []

    def fake_runner(command, *, stdin_path=None):
        calls.append((command, stdin_path))
        if command[-3:] == ["ls", "--json", "target/carameli-backups/"]:
            return _listing("carameli-20260718T010000Z.dump")
        if command[-1] == "--command=SELECT count(*) FROM call_events;":
            return "42\n"
        return ""

    def fake_downloader(command, destination: Path):
        downloaded.append((command, destination.name))
        destination.write_bytes(b"custom-format-dump")

    result = mod.restore_latest(
        "carameli-backups",
        "carameli_restore_test",
        runner=fake_runner,
        downloader=fake_downloader,
    )

    assert result == mod.RestoreResult("carameli-20260718T010000Z.dump", 42)
    assert downloaded[0][0] == mod.compose_exec(
        "db-backup", "mc", "cat", "target/carameli-backups/carameli-20260718T010000Z.dump"
    )
    pg_restore_calls = [call for call in calls if "pg_restore" in call[0]]
    assert len(pg_restore_calls) == 1
    assert pg_restore_calls[0][1].name == "carameli-20260718T010000Z.dump"
    assert sum("dropdb" in command for command, _ in calls) == 2


def test_restore_latest_cleans_up_after_restore_failure():
    calls = []

    def fake_runner(command, *, stdin_path=None):
        calls.append(command)
        if command[-3:] == ["ls", "--json", "target/carameli-backups/"]:
            return _listing("carameli-20260718T010000Z.dump")
        if "pg_restore" in command:
            raise RuntimeError("restore failed")
        return ""

    def fake_downloader(command, destination: Path):
        destination.write_bytes(b"broken-dump")

    with pytest.raises(RuntimeError, match="restore failed"):
        mod.restore_latest(
            "carameli-backups",
            "carameli_restore_test",
            runner=fake_runner,
            downloader=fake_downloader,
        )

    assert sum("dropdb" in command for command in calls) == 2


def test_format_verdict_reports_backup_and_count():
    result = mod.RestoreResult("carameli-20260718T010000Z.dump", 7)
    assert mod.format_verdict(result) == (
        "PASS: restored carameli-20260718T010000Z.dump; call_events contains 7 row(s)"
    )


def test_main_returns_failure_verdict(monkeypatch, capsys):
    def fail_restore(*args, **kwargs):
        raise ValueError("no backup found")

    monkeypatch.setattr(mod, "restore_latest", fail_restore)

    assert mod.main([]) == 1
    assert "FAIL: no backup found" in capsys.readouterr().err
