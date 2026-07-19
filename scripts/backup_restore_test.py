#!/usr/bin/env python3
"""Restore the newest database backup into a disposable PostgreSQL database."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_BUCKET = os.environ.get("BACKUP_S3_BUCKET", "carameli-backups")
DEFAULT_RESTORE_DATABASE = "carameli_restore_test"
SOURCE_DATABASE = "carameli"
_DATABASE_RE = re.compile(r"^[a-z][a-z0-9_]{0,62}$")
_BUCKET_RE = re.compile(r"^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$")


@dataclass(frozen=True)
class RestoreResult:
    object_key: str
    call_event_count: int


Runner = Callable[..., str]
Downloader = Callable[[Sequence[str], Path], None]


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Restore the newest S3 backup and verify that call_events is readable."
    )
    parser.add_argument(
        "--bucket",
        default=DEFAULT_BUCKET,
        help=f"backup bucket name (default: {DEFAULT_BUCKET})",
    )
    parser.add_argument(
        "--database",
        default=DEFAULT_RESTORE_DATABASE,
        help=f"disposable restore database (default: {DEFAULT_RESTORE_DATABASE})",
    )
    args = parser.parse_args(argv)
    validate_arguments(args.bucket, args.database, parser)
    return args


def validate_arguments(
    bucket: str, database: str, parser: argparse.ArgumentParser | None = None
) -> None:
    error = ""
    if not _BUCKET_RE.fullmatch(bucket):
        error = f"invalid S3 bucket name: {bucket!r}"
    elif not _DATABASE_RE.fullmatch(database):
        error = f"invalid PostgreSQL database name: {database!r}"
    elif database == SOURCE_DATABASE:
        error = "refusing to use the live carameli database as the restore-test target"
    if error and parser is not None:
        parser.error(error)
    if error:
        raise ValueError(error)


def compose_exec(service: str, *command: str) -> list[str]:
    return ["docker", "compose", "exec", "-T", service, *command]


def select_newest_dump(listing: str) -> str:
    keys: list[str] = []
    for line in listing.splitlines():
        if not line.strip():
            continue
        item = json.loads(line)
        key = item.get("key", "")
        name = Path(key).name
        if name.startswith("carameli-") and name.endswith(".dump"):
            keys.append(key)
    if not keys:
        raise ValueError("no carameli-*.dump backups found")
    return max(keys)


def parse_call_event_count(output: str) -> int:
    value = output.strip()
    if not value.isdecimal():
        raise ValueError(f"unexpected call_events count: {value!r}")
    return int(value)


def run_command(command: Sequence[str], *, stdin_path: Path | None = None) -> str:
    stdin = stdin_path.open("rb") if stdin_path is not None else None
    try:
        result = subprocess.run(
            list(command),
            cwd=REPO_ROOT,
            stdin=stdin,
            capture_output=True,
            check=True,
            text=True,
        )
    finally:
        if stdin is not None:
            stdin.close()
    return result.stdout


def download_command(command: Sequence[str], destination: Path) -> None:
    with destination.open("wb") as output:
        result = subprocess.run(
            list(command),
            cwd=REPO_ROOT,
            stdout=output,
            stderr=subprocess.PIPE,
            check=False,
        )
    if result.returncode != 0:
        stderr = result.stderr.decode(errors="replace")
        raise RuntimeError(f"backup download failed: {stderr.strip()}")


def restore_latest(
    bucket: str,
    database: str,
    *,
    runner: Runner | None = None,
    downloader: Downloader | None = None,
) -> RestoreResult:
    validate_arguments(bucket, database)
    runner = runner or run_command
    downloader = downloader or download_command

    listing = runner(compose_exec("db-backup", "mc", "ls", "--json", f"target/{bucket}/"))
    object_key = select_newest_dump(listing)
    db_args = ("--username=carameli", f"--dbname={database}")

    runner(compose_exec("db", "dropdb", "--username=carameli", "--if-exists", "--force", database))
    created = False
    try:
        runner(compose_exec("db", "createdb", "--username=carameli", database))
        created = True
        with tempfile.TemporaryDirectory(prefix="carameli-restore-") as temp_dir:
            dump_path = Path(temp_dir) / Path(object_key).name
            downloader(
                compose_exec("db-backup", "mc", "cat", f"target/{bucket}/{object_key}"),
                dump_path,
            )
            runner(
                compose_exec(
                    "db",
                    "pg_restore",
                    "--exit-on-error",
                    "--no-owner",
                    *db_args,
                ),
                stdin_path=dump_path,
            )
        count_output = runner(
            compose_exec(
                "db",
                "psql",
                *db_args,
                "--tuples-only",
                "--no-align",
                "--command=SELECT count(*) FROM call_events;",
            )
        )
        return RestoreResult(object_key, parse_call_event_count(count_output))
    finally:
        if created:
            runner(
                compose_exec(
                    "db", "dropdb", "--username=carameli", "--if-exists", "--force", database
                )
            )


def format_verdict(result: RestoreResult) -> str:
    return (
        f"PASS: restored {result.object_key}; call_events contains {result.call_event_count} row(s)"
    )


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        result = restore_latest(args.bucket, args.database)
    except (
        json.JSONDecodeError,
        OSError,
        RuntimeError,
        subprocess.CalledProcessError,
        ValueError,
    ) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    print(format_verdict(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
