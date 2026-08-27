"""Tests for `scripts/db-snapshot.py`.

The subprocess wrappers (`read_dump`, `read_row_counts`) are the only surface that
needs a live stack; everything that decides *whether a snapshot is worth anything*
is pure and covered here. The empty-snapshot cases are the point of the file: the
MinIO dump this script was written to replace was a valid archive holding zero
rows, and nothing anywhere said so.
"""

import json
import subprocess

import pytest
from conftest import load_module

db = load_module("scripts/db-snapshot.py")


# --- labels and filenames ---------------------------------------------------


@pytest.mark.parametrize("label", ["before-migration", "a", "x1", "0", "a" * 40])
def test_validate_label_accepts_filename_safe_tags(label):
    assert db.validate_label(label) == label


@pytest.mark.parametrize(
    "label",
    [
        "",  # empty is the "no label" case, handled by snapshot_stem, not here
        "Before-Migration",  # uppercase
        "before migration",  # space
        "../escape",  # path traversal
        "-leading",  # must start alphanumeric
        "a" * 41,  # too long
    ],
)
def test_validate_label_rejects_anything_that_could_escape_a_filename(label):
    with pytest.raises(ValueError):
        db.validate_label(label)


def test_snapshot_stem_without_a_label_is_just_database_and_stamp():
    assert db.snapshot_stem("20260827T120000Z") == "carameli-20260827T120000Z"


def test_snapshot_stem_appends_a_validated_label():
    assert db.snapshot_stem("20260827T120000Z", "pre-restore") == (
        "carameli-20260827T120000Z-pre-restore"
    )


def test_snapshot_stem_refuses_an_unsafe_label():
    with pytest.raises(ValueError):
        db.snapshot_stem("20260827T120000Z", "../../etc")


def test_utc_stamp_is_sortable_so_the_name_orders_the_snapshots():
    from datetime import datetime, timezone

    earlier = db.utc_stamp(datetime(2026, 8, 27, 12, 0, 0, tzinfo=timezone.utc))
    later = db.utc_stamp(datetime(2026, 8, 27, 12, 0, 1, tzinfo=timezone.utc))
    assert earlier == "20260827T120000Z"
    assert earlier < later


def test_manifest_path_sits_beside_the_dump(tmp_path):
    dump = tmp_path / "carameli-20260827T120000Z.dump"
    manifest = db.manifest_path(dump)
    assert manifest.name == "carameli-20260827T120000Z.json"
    assert manifest.parent == dump.parent


# --- row counts -------------------------------------------------------------


def test_parse_row_counts_reads_psql_pipe_output():
    assert db.parse_row_counts("customers|1\nextensions|3\nphone_lines|0\n") == {
        "customers": 1,
        "extensions": 3,
        "phone_lines": 0,
    }


def test_parse_row_counts_skips_blank_and_malformed_lines():
    # psql writes notices and rule separators around the rows on some settings; a
    # stray line must not take down a save that is otherwise fine.
    text = "\ncustomers|1\n(1 row)\nbroken|1|2\nextensions|two\nphone_lines|4\n"
    assert db.parse_row_counts(text) == {"customers": 1, "phone_lines": 4}


def test_total_rows_sums_every_table():
    assert db.total_rows({"customers": 1, "extensions": 3, "phone_lines": 0}) == 4


def test_total_rows_of_an_empty_database_is_zero():
    assert db.total_rows({"customers": 0, "extensions": 0}) == 0


def test_populated_tables_drops_the_empty_ones_and_sorts():
    assert db.populated_tables({"z": 2, "empty": 0, "a": 1}) == {"a": 1, "z": 2}


# --- archive validity -------------------------------------------------------


def test_is_valid_dump_accepts_a_custom_format_archive():
    assert db.is_valid_dump(b"PGDMP\x01\x0e\x00")


@pytest.mark.parametrize(
    "data",
    [
        b"",  # nothing came back
        b"Error response from daemon: container not running\n",  # docker on stdout
        b"--\n-- PostgreSQL database dump\n--\n",  # plain SQL, not -Fc
    ],
)
def test_is_valid_dump_rejects_anything_pg_restore_could_not_read(data):
    assert not db.is_valid_dump(data)


# --- listing ----------------------------------------------------------------


def _write_snapshot(directory, stem, counts, payload=b"PGDMP\x01"):
    dump = directory / f"{stem}.dump"
    dump.write_bytes(payload)
    db.manifest_path(dump).write_text(
        json.dumps({"total_rows": db.total_rows(counts), "row_counts": counts}),
        encoding="utf-8",
    )
    return dump


def test_sort_newest_first_orders_by_the_sortable_stamp(tmp_path):
    old = tmp_path / "carameli-20260101T000000Z.dump"
    new = tmp_path / "carameli-20260827T120000Z.dump"
    assert db.sort_newest_first([old, new]) == [new, old]


def test_load_snapshots_pairs_each_dump_with_its_manifest(tmp_path):
    _write_snapshot(tmp_path, "carameli-20260101T000000Z", {"customers": 0})
    _write_snapshot(tmp_path, "carameli-20260827T120000Z", {"customers": 1})
    entries = db.load_snapshots(tmp_path)
    assert [p.name for p, _ in entries] == [
        "carameli-20260827T120000Z.dump",
        "carameli-20260101T000000Z.dump",
    ]
    assert entries[0][1]["total_rows"] == 1


def test_load_snapshots_of_a_missing_directory_is_empty(tmp_path):
    assert db.load_snapshots(tmp_path / "nope") == []


def test_load_snapshots_survives_a_corrupt_manifest(tmp_path):
    dump = tmp_path / "carameli-20260827T120000Z.dump"
    dump.write_bytes(b"PGDMP\x01")
    db.manifest_path(dump).write_text("{not json", encoding="utf-8")
    entries = db.load_snapshots(tmp_path)
    # The dump is still listed -- a manifest that will not parse is a reason to show
    # the file with no counts, not a reason to hide a recoverable archive.
    assert [p.name for p, _ in entries] == ["carameli-20260827T120000Z.dump"]
    assert entries[0][1] == {}


def test_load_snapshots_reads_snapshot_dir_at_call_time(tmp_path, monkeypatch):
    # Regression: `SNAPSHOT_DIR` was bound as a default argument, so it was read once
    # at import and every later change to the constant was ignored -- which meant the
    # module constant was not actually the authority it reads as.
    _write_snapshot(tmp_path, "carameli-20260827T120000Z", {"customers": 1})
    monkeypatch.setattr(db, "SNAPSHOT_DIR", tmp_path)
    assert [p.name for p, _ in db.load_snapshots()] == ["carameli-20260827T120000Z.dump"]


def test_save_writes_to_snapshot_dir_at_call_time(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "SNAPSHOT_DIR", tmp_path)
    monkeypatch.setattr(db, "read_row_counts", lambda: {"customers": 1})
    monkeypatch.setattr(db, "read_dump", lambda: b"PGDMP\x01")
    assert db.save().parent == tmp_path


def test_display_path_shortens_a_snapshot_inside_the_repo(tmp_path):
    assert db.display_path(tmp_path / "a" / "b.dump", tmp_path) == str(db.Path("a/b.dump"))


def test_display_path_falls_back_to_the_full_path_outside_the_repo(tmp_path):
    outside = tmp_path / "elsewhere" / "b.dump"
    assert db.display_path(outside, tmp_path / "repo") == str(outside)


def test_format_listing_says_where_to_look_when_there_is_nothing(tmp_path):
    assert "No snapshots" in db.format_listing([])


def test_format_listing_flags_an_empty_snapshot(tmp_path):
    empty = _write_snapshot(tmp_path, "carameli-20260101T000000Z", {"customers": 0})
    full = _write_snapshot(tmp_path, "carameli-20260827T120000Z", {"customers": 1})
    out = db.format_listing(
        [(full, {"row_counts": {"customers": 1}}), (empty, {"row_counts": {"customers": 0}})]
    )
    lines = out.splitlines()
    assert "(EMPTY)" in lines[2] and "(EMPTY)" not in lines[1]


# --- save -------------------------------------------------------------------


def test_save_writes_the_archive_verbatim_and_a_manifest(tmp_path, monkeypatch):
    payload = b"PGDMP\x01\x0e\x00\xff\xfe binary \r\n bytes"
    monkeypatch.setattr(db, "read_row_counts", lambda: {"customers": 1, "extensions": 0})
    monkeypatch.setattr(db, "read_dump", lambda: payload)
    dump = db.save(directory=tmp_path)
    # Byte-for-byte: a text-mode write on Windows would re-encode and translate the
    # \r\n, and pg_restore would reject what came back.
    assert dump.read_bytes() == payload
    manifest = json.loads(db.manifest_path(dump).read_text(encoding="utf-8"))
    assert manifest["total_rows"] == 1
    assert manifest["row_counts"] == {"customers": 1, "extensions": 0}
    assert manifest["bytes"] == len(payload)


def test_save_labels_the_filename(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "read_row_counts", lambda: {"customers": 1})
    monkeypatch.setattr(db, "read_dump", lambda: b"PGDMP\x01")
    dump = db.save(label="pre-restore", directory=tmp_path)
    assert dump.name.endswith("-pre-restore.dump")


def test_save_refuses_to_write_something_that_is_not_an_archive(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "read_row_counts", lambda: {"customers": 1})
    monkeypatch.setattr(db, "read_dump", lambda: b"Error response from daemon: no such service")
    with pytest.raises(RuntimeError, match="custom-format archive"):
        db.save(directory=tmp_path)
    assert list(tmp_path.glob("*.dump")) == []


def test_save_records_an_empty_database_rather_than_refusing(tmp_path, monkeypatch):
    # Saving an empty database is legitimate (a bare schema is a useful baseline);
    # what must never happen is it being *indistinguishable* from a full one.
    monkeypatch.setattr(db, "read_row_counts", lambda: {"customers": 0, "extensions": 0})
    monkeypatch.setattr(db, "read_dump", lambda: b"PGDMP\x01")
    dump = db.save(directory=tmp_path)
    assert json.loads(db.manifest_path(dump).read_text(encoding="utf-8"))["total_rows"] == 0


# --- restore ----------------------------------------------------------------


def test_restore_refuses_an_empty_snapshot(tmp_path, monkeypatch):
    dump = _write_snapshot(tmp_path, "carameli-20260101T000000Z", {"customers": 0})
    called = []
    monkeypatch.setattr(db.subprocess, "run", lambda *a, **k: called.append(a))
    with pytest.raises(RuntimeError, match="zero rows"):
        db.restore(dump)
    assert called == []


def test_restore_allows_an_empty_snapshot_when_asked_outright(tmp_path, monkeypatch):
    dump = _write_snapshot(tmp_path, "carameli-20260101T000000Z", {"customers": 0})
    calls = []
    monkeypatch.setattr(db.subprocess, "run", lambda *a, **k: calls.append((a, k)))
    db.restore(dump, allow_empty=True)
    assert len(calls) == 1


def test_restore_feeds_the_archive_to_pg_restore_on_stdin(tmp_path, monkeypatch):
    payload = b"PGDMP\x01\x0e\x00binary"
    dump = _write_snapshot(tmp_path, "carameli-20260827T120000Z", {"customers": 1}, payload)
    calls = []
    monkeypatch.setattr(db.subprocess, "run", lambda *a, **k: calls.append((a, k)))
    db.restore(dump)
    argv, kwargs = calls[0]
    assert kwargs["input"] == payload
    assert "pg_restore" in argv[0]
    assert "--clean" in argv[0] and "--if-exists" in argv[0]


def test_restore_rejects_a_file_that_is_not_an_archive(tmp_path, monkeypatch):
    dump = tmp_path / "carameli-20260827T120000Z.dump"
    dump.write_bytes(b"not a dump")
    monkeypatch.setattr(db.subprocess, "run", lambda *a, **k: pytest.fail("should not run"))
    with pytest.raises(RuntimeError, match="custom-format archive"):
        db.restore(dump)


# --- CLI --------------------------------------------------------------------


def test_parse_args_requires_a_mode():
    with pytest.raises(SystemExit):
        db.parse_args([])


def test_parse_args_save_takes_an_optional_label():
    assert db.parse_args(["save"]).label == ""
    assert db.parse_args(["save", "--label", "pre-restore"]).label == "pre-restore"


def test_parse_args_dir_defaults_to_none_on_every_mode():
    assert db.parse_args(["save"]).dir is None
    assert db.parse_args(["list"]).dir is None
    assert db.parse_args(["restore", "--latest"]).dir is None


def test_main_save_honours_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "read_row_counts", lambda: {"customers": 1})
    monkeypatch.setattr(db, "read_dump", lambda: b"PGDMP\x01")
    assert db.main(["save", "--dir", str(tmp_path)]) == 0
    assert len(list(tmp_path.glob("*.dump"))) == 1


def test_main_list_honours_dir(tmp_path, capsys):
    _write_snapshot(tmp_path, "carameli-20260827T120000Z", {"customers": 1})
    assert db.main(["list", "--dir", str(tmp_path)]) == 0
    assert "carameli-20260827T120000Z.dump" in capsys.readouterr().out


def test_main_restore_latest_honours_dir(tmp_path, monkeypatch):
    _write_snapshot(tmp_path, "carameli-20260827T120000Z", {"customers": 1})
    restored = []
    monkeypatch.setattr(db, "restore", lambda dump, allow_empty=False: restored.append(dump))
    assert db.main(["restore", "--latest", "--yes", "--dir", str(tmp_path)]) == 0
    assert restored[0].parent == tmp_path


def test_parse_args_restore_defaults_to_refusing():
    args = db.parse_args(["restore", "--latest"])
    assert args.latest is True and args.yes is False and args.allow_empty is False


def test_main_restore_without_yes_changes_nothing(tmp_path, monkeypatch, capsys):
    _write_snapshot(tmp_path, "carameli-20260827T120000Z", {"customers": 1})
    monkeypatch.setattr(db, "SNAPSHOT_DIR", tmp_path)
    monkeypatch.setattr(db, "restore", lambda *a, **k: pytest.fail("restored without --yes"))
    assert db.main(["restore", "--latest"]) == 1
    assert "--yes" in capsys.readouterr().err


def test_main_restore_latest_picks_the_newest(tmp_path, monkeypatch):
    _write_snapshot(tmp_path, "carameli-20260101T000000Z", {"customers": 1})
    _write_snapshot(tmp_path, "carameli-20260827T120000Z", {"customers": 9})
    monkeypatch.setattr(db, "SNAPSHOT_DIR", tmp_path)
    restored = []
    monkeypatch.setattr(db, "restore", lambda dump, allow_empty=False: restored.append(dump))
    assert db.main(["restore", "--latest", "--yes"]) == 0
    assert restored[0].name == "carameli-20260827T120000Z.dump"


def test_main_restore_latest_with_no_snapshots_fails_loudly(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(db, "SNAPSHOT_DIR", tmp_path)
    assert db.main(["restore", "--latest"]) == 1
    assert "no snapshots" in capsys.readouterr().err


def test_main_restore_reports_a_failed_pg_restore(tmp_path, monkeypatch, capsys):
    dump = _write_snapshot(tmp_path, "carameli-20260827T120000Z", {"customers": 1})
    monkeypatch.setattr(db, "SNAPSHOT_DIR", tmp_path)

    def boom(*_a, **_k):
        raise subprocess.CalledProcessError(1, "pg_restore", stderr=b"relation does not exist")

    monkeypatch.setattr(db, "restore", boom)
    assert db.main(["restore", str(dump), "--yes"]) == 1
    assert "restore failed" in capsys.readouterr().err


def test_main_save_warns_when_the_snapshot_recovers_nothing(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(db, "SNAPSHOT_DIR", tmp_path)
    monkeypatch.setattr(db, "read_row_counts", lambda: {"customers": 0})
    monkeypatch.setattr(db, "read_dump", lambda: b"PGDMP\x01")
    assert db.main(["save"]) == 0
    assert "WARNING" in capsys.readouterr().err


def test_main_save_summarises_the_tables_that_hold_rows(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(db, "SNAPSHOT_DIR", tmp_path)
    monkeypatch.setattr(db, "read_row_counts", lambda: {"customers": 1, "extensions": 0})
    monkeypatch.setattr(db, "read_dump", lambda: b"PGDMP\x01")
    assert db.main(["save"]) == 0
    out = capsys.readouterr().out
    assert "customers=1" in out and "extensions" not in out.split("customers=1")[1]


def test_main_list_prints_the_snapshots_it_finds(tmp_path, monkeypatch, capsys):
    _write_snapshot(tmp_path, "carameli-20260827T120000Z", {"customers": 1})
    monkeypatch.setattr(db, "SNAPSHOT_DIR", tmp_path)
    assert db.main(["list"]) == 0
    assert "carameli-20260827T120000Z.dump" in capsys.readouterr().out
