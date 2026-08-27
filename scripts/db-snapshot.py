#!/usr/bin/env python3
"""Take, list and restore host-side snapshots of the local dev database.

**Why this exists alongside the `db-backup` service.** That container dumps into
MinIO, and MinIO's storage is the `carameli_miniodata` *Docker volume* -- in the
same daemon, on the same disk, as `carameli_pgdata`. Anything that takes the
volumes takes the backups with them, so it cannot be the recovery path for the
volumes being lost. Snapshots here land on the host filesystem under
`.local/db-snapshots/`, which no `docker volume prune`, no `compose down -v` and
no `worktree.py reap` can reach.

**Why every snapshot carries a row-count manifest.** On 2026-08-27 the only dump
in MinIO was a valid archive that restored cleanly and contained zero rows in
every table: it had been taken minutes after the database was emptied, and
nothing about it said so. A dump that *restores* is not the same as a dump that
*holds anything*. The sidecar manifest puts the row counts in `list`, months
before anyone needs the file, and `restore` refuses an empty snapshot outright
rather than quietly flattening a populated database with it.

Usage:

    python scripts/db-snapshot.py save [--label before-migration]
    python scripts/db-snapshot.py list
    python scripts/db-snapshot.py restore --latest --yes
    python scripts/db-snapshot.py restore .local/db-snapshots/<name>.dump --yes

`--dir` points any of the three somewhere else -- an external drive, a share, or the
primary checkout when this is run from a disposable worktree.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent))

from docker_common import REPO_ROOT, project_name

SNAPSHOT_DIR = REPO_ROOT / ".local" / "db-snapshots"
DB_SERVICE = "db"
DB_USER = "carameli"
DB_NAME = "carameli"

# A PostgreSQL custom-format archive starts with this magic. Checking it is how a
# dump that is really a docker error message on stdout gets caught at save time
# rather than at restore time.
DUMP_MAGIC = b"PGDMP"

_LABEL_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")

# Exact per-table counts in one round trip. `pg_stat_user_tables.n_live_tup` would
# be cheaper but it is an estimator: it reads 0 for every table until autovacuum
# catches up after a restore, which is indistinguishable from the empty dump this
# manifest exists to detect.
ROW_COUNT_SQL = """
SELECT table_name,
       (xpath('/row/c/text()',
              query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name),
                           false, true, '')))[1]::text::bigint AS n
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name
"""


# --- pure helpers -----------------------------------------------------------


def validate_label(label: str) -> str:
    """Return `label` if it is safe to put in a filename, else raise ValueError."""
    if not _LABEL_RE.fullmatch(label):
        raise ValueError(
            f"invalid label {label!r}: use lowercase letters, digits and hyphens (max 40)"
        )
    return label


def snapshot_stem(stamp: str, label: str = "") -> str:
    """Filename stem for a snapshot taken at `stamp`, optionally tagged."""
    return f"{DB_NAME}-{stamp}-{validate_label(label)}" if label else f"{DB_NAME}-{stamp}"


def utc_stamp(now: datetime | None = None) -> str:
    """Sortable UTC stamp, matching the `db-backup` container's naming."""
    return (now or datetime.now(timezone.utc)).strftime("%Y%m%dT%H%M%SZ")


def manifest_path(dump: Path) -> Path:
    """Sidecar manifest for a dump file."""
    return dump.with_suffix(".json")


def parse_row_counts(text: str) -> dict[str, int]:
    """Parse `psql -At -F'|'` output into {table: rows}.

    Blank lines and anything without exactly one separator are skipped: psql
    writes notices to stderr, but a stray line here should not take down a save.
    """
    counts: dict[str, int] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.count("|") != 1:
            continue
        name, _, raw = line.partition("|")
        try:
            counts[name] = int(raw)
        except ValueError:
            continue
    return counts


def total_rows(counts: dict[str, int]) -> int:
    """Total rows across every table in a manifest."""
    return sum(counts.values())


def is_valid_dump(data: bytes) -> bool:
    """True when `data` looks like a PostgreSQL custom-format archive."""
    return data.startswith(DUMP_MAGIC)


def populated_tables(counts: dict[str, int]) -> dict[str, int]:
    """Just the tables that actually hold rows, for a compact summary."""
    return {name: n for name, n in sorted(counts.items()) if n > 0}


def format_listing(entries: Sequence[tuple[Path, dict]]) -> str:
    """Human-readable `list` output, newest first."""
    if not entries:
        return f"No snapshots in {SNAPSHOT_DIR}.\nTake one: python scripts/db-snapshot.py save"
    lines = [f"{'snapshot':<44} {'size':>9} {'rows':>8}  tables"]
    for dump, manifest in entries:
        counts = manifest.get("row_counts", {})
        rows = total_rows(counts)
        size = dump.stat().st_size if dump.exists() else 0
        filled = len(populated_tables(counts))
        flag = "  (EMPTY)" if rows == 0 else ""
        lines.append(f"{dump.name:<44} {size:>8,}B {rows:>8,}  {filled}{flag}")
    return "\n".join(lines)


def sort_newest_first(dumps: Sequence[Path]) -> list[Path]:
    """Snapshots newest first. The stamp is sortable, so the name is the key."""
    return sorted(dumps, key=lambda p: p.name, reverse=True)


def display_path(path: Path, root: Path = REPO_ROOT) -> str:
    """`path` written relative to the repo when it is inside it, else in full.

    A snapshot normally lives under `.local/`, and `.local/db-snapshots/x.dump` is
    the form worth printing. `relative_to` raises rather than falling back when it
    is not, though, so a directory pointed elsewhere would turn a successful save
    into a traceback at the last line of `main`.
    """
    try:
        return str(path.relative_to(root))
    except ValueError:
        return str(path)


# --- impure surface ---------------------------------------------------------


def _compose(args: list[str]) -> list[str]:
    return ["docker", "compose", "-p", project_name(), "exec", "-T", DB_SERVICE, *args]


def read_row_counts() -> dict[str, int]:
    """Exact per-table row counts from the live database."""
    completed = subprocess.run(
        _compose(["psql", "-U", DB_USER, "-d", DB_NAME, "-At", "-F", "|", "-c", ROW_COUNT_SQL]),
        capture_output=True,
        text=True,
        timeout=120,
        check=True,
    )
    return parse_row_counts(completed.stdout)


def read_dump() -> bytes:
    """A custom-format `pg_dump` of the whole database, as bytes."""
    completed = subprocess.run(
        _compose(["pg_dump", "-U", DB_USER, "-Fc", "-d", DB_NAME]),
        capture_output=True,
        timeout=600,
        check=True,
    )
    return completed.stdout


def load_snapshots(directory: Path | None = None) -> list[tuple[Path, dict]]:
    """Every snapshot in `directory`, newest first, paired with its manifest.

    Resolved at call time rather than as a default argument, so `SNAPSHOT_DIR`
    stays the authority: bound as a default it is read once at import and every
    later change to the constant is silently ignored.
    """
    directory = SNAPSHOT_DIR if directory is None else directory
    if not directory.is_dir():
        return []
    out: list[tuple[Path, dict]] = []
    for dump in sort_newest_first(list(directory.glob("*.dump"))):
        manifest: dict = {}
        side = manifest_path(dump)
        if side.is_file():
            try:
                manifest = json.loads(side.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                manifest = {}
        out.append((dump, manifest))
    return out


def save(label: str = "", directory: Path | None = None) -> Path:
    """Dump the database to `directory` with a row-count manifest. Returns the dump path.

    `directory` defaults to `SNAPSHOT_DIR` at call time -- see `load_snapshots`.
    """
    directory = SNAPSHOT_DIR if directory is None else directory
    counts = read_row_counts()
    data = read_dump()
    if not is_valid_dump(data):
        raise RuntimeError(
            "pg_dump did not return a custom-format archive -- refusing to write a "
            f"corrupt snapshot (got {data[:80]!r})"
        )
    directory.mkdir(parents=True, exist_ok=True)
    dump = directory / f"{snapshot_stem(utc_stamp(), label)}.dump"
    # Binary mode throughout: this is an archive, and on Windows a text-mode write
    # would both re-encode and translate newlines through it.
    dump.write_bytes(data)
    manifest_path(dump).write_text(
        json.dumps(
            {
                "database": DB_NAME,
                "taken_at": utc_stamp(),
                "label": label,
                "bytes": len(data),
                "total_rows": total_rows(counts),
                "row_counts": counts,
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    return dump


def restore(dump: Path, allow_empty: bool = False) -> None:
    """Restore `dump` over the live database. Destructive; callers gate on --yes."""
    data = dump.read_bytes()
    if not is_valid_dump(data):
        raise RuntimeError(f"{dump} is not a PostgreSQL custom-format archive")
    side = manifest_path(dump)
    if side.is_file() and not allow_empty:
        manifest = json.loads(side.read_text(encoding="utf-8"))
        if manifest.get("total_rows", 0) == 0:
            raise RuntimeError(
                f"{dump.name} holds zero rows in every table. Restoring it would empty "
                "the database rather than recover it. Pass --allow-empty if that is "
                "genuinely what you want (e.g. resetting to a bare schema)."
            )
    subprocess.run(
        _compose(
            ["pg_restore", "--clean", "--if-exists", "--no-owner", "-U", DB_USER, "-d", DB_NAME]
        ),
        input=data,
        capture_output=True,
        timeout=600,
        check=True,
    )


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="mode", required=True)

    # `--dir` on all three: the snapshots are the one thing here worth keeping
    # somewhere the repository is not -- an external drive, a share, or the primary
    # checkout when this is being run from a disposable worktree.
    def with_dir(p: argparse.ArgumentParser) -> argparse.ArgumentParser:
        p.add_argument("--dir", default=None, help=f"snapshot directory (default {SNAPSHOT_DIR})")
        return p

    p_save = with_dir(sub.add_parser("save", help="dump the dev database to .local/db-snapshots/"))
    p_save.add_argument(
        "--label", default="", help="short tag for the filename, e.g. before-migration"
    )

    with_dir(sub.add_parser("list", help="list snapshots with their row counts"))

    p_restore = with_dir(sub.add_parser("restore", help="restore a snapshot over the dev database"))
    p_restore.add_argument("path", nargs="?", help="snapshot to restore")
    p_restore.add_argument("--latest", action="store_true", help="restore the newest snapshot")
    p_restore.add_argument("--yes", action="store_true", help="required: this overwrites data")
    p_restore.add_argument(
        "--allow-empty", action="store_true", help="permit restoring a zero-row snapshot"
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    directory = Path(args.dir) if args.dir else None

    if args.mode == "save":
        try:
            dump = save(args.label, directory)
        except (subprocess.CalledProcessError, RuntimeError, ValueError) as exc:
            print(f"snapshot failed: {exc}", file=sys.stderr)
            return 1
        manifest = json.loads(manifest_path(dump).read_text(encoding="utf-8"))
        rows = manifest["total_rows"]
        print(f"saved {display_path(dump)}  ({manifest['bytes']:,}B, {rows:,} rows)")
        if rows == 0:
            print(
                "  WARNING: every table is empty. This snapshot recovers nothing --\n"
                "  check you meant to snapshot this database before relying on it.",
                file=sys.stderr,
            )
        else:
            summary = ", ".join(
                f"{k}={v}" for k, v in populated_tables(manifest["row_counts"]).items()
            )
            print(f"  {summary}")
        return 0

    if args.mode == "list":
        print(format_listing(load_snapshots(directory)))
        return 0

    # restore
    entries = load_snapshots(directory)
    if args.latest:
        if not entries:
            print(f"no snapshots in {directory or SNAPSHOT_DIR}", file=sys.stderr)
            return 1
        target = entries[0][0]
    elif args.path:
        target = Path(args.path)
        if not target.is_file():
            print(f"no such snapshot: {target}", file=sys.stderr)
            return 1
    else:
        print("give a snapshot path or --latest", file=sys.stderr)
        return 1

    if not args.yes:
        print(
            f"restore would overwrite the '{DB_NAME}' database from {target.name}.\n"
            "Re-run with --yes once you are sure.",
            file=sys.stderr,
        )
        return 1

    try:
        restore(target, allow_empty=args.allow_empty)
    except (subprocess.CalledProcessError, RuntimeError) as exc:
        detail = (
            exc.stderr.decode(errors="replace")
            if isinstance(exc, subprocess.CalledProcessError)
            else exc
        )
        print(f"restore failed: {detail}", file=sys.stderr)
        return 1
    print(f"restored {DB_NAME} from {target.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
