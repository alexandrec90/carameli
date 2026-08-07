#!/usr/bin/env python3
"""Bounds the growth of `logs/` so stale material never buries the current signal.

`logs/` holds two kinds of file and they need opposite treatment:

**Current failure artifacts** (`logs/lint-errors.log`, `logs/test-failures.log`,
`logs/stop-verify.log`, ...) are *state*, not history. Each runner overwrites its
own artifact every run, so there is exactly one of each and an old mtime means
"nothing has re-run since", which is information. **These are never pruned** — see
`PROTECTED`. Deleting one would make `stop.py` and `diagnostics.py` read a missing
file as "clean" and report green having checked nothing.

**Accumulating history** (dated session dumps, per-run docker captures, rotation
backups, superseded junit XML) has no such contract: nothing reads a six-week-old
copy, and left alone it grows without limit. That is what this prunes, by age,
per `POLICIES`.

One append-only file, the OTel telemetry sink, fits neither shape: it is a single
live file that only ever grows. It gets a byte cap with tail preservation instead
(`trim_to_tail`), because the recent end is the useful end.

Runs from the SessionStart hook in `.claude/settings.json` — once per session,
cheap (an mtime scan), and self-limiting. It is wired there rather than inside
`.claude/hooks/session-start.sh` because that file is vendored byte-identical from
devkit; editing it would be reported as drift by `scripts/sync-devkit.py --check`.

Stdlib only: the SessionStart hook runs before the venv is guaranteed to exist.

The pure helpers (`is_expired`, `select_expired`, `plan_prune`, `format_summary`)
are unit-tested in `scripts/hooks/tests/test_prune_logs.py`.

Usage: python scripts/prune-logs.py [--dry-run] [--quiet]
"""

import argparse
import sys
import time
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
LOGS_DIR = REPO_ROOT / "logs"

SECONDS_PER_DAY = 86400


@dataclass(frozen=True)
class Policy:
    """Delete files under `subdir` matching `pattern` older than `max_age_days`.

    `subdir` is relative to `logs/`; `""` means the top level, non-recursively.
    """

    subdir: str
    pattern: str
    max_age_days: int
    reason: str


# Never delete these, whatever their age — they are current state, and their
# absence is read as "clean" by the runners that consume them.
PROTECTED = frozenset(
    {
        "lint-errors.log",
        "test-failures.log",
        "frontend-test-failures.log",
        "e2e-failures.log",
        "ci-failures.log",
        "stop-verify.log",
        "pre-commit-errors.log",
        "deps-lock-errors.log",
        "log-errors.log",
        "connectivity-probe.log",
        "eval-spend.log",
    }
)

POLICIES = (
    # Dated session dumps. The writers (archive-session*.py) were removed, so in
    # practice this only drains what is already there — but the policy stays so a
    # re-introduced writer is bounded from day one.
    Policy("agent", "*.json", 30, "session dumps"),
    Policy("agent", "*.txt", 30, "hook test sentinels"),
    # Per-run docker captures: overwritten by name each run, so anything this old
    # is from a stack that has since been rebuilt.
    Policy("docker", "*.log", 14, "docker run captures"),
    # Rotation backups only — never `carameli.log` itself. RotatingFileHandler
    # caps the set at 5 while the app runs; these linger after it stops.
    Policy("runtime", "carameli.log.*", 14, "rotation backups"),
    # Superseded: CI writes junit to `reports/`, nothing writes it to `logs/`.
    Policy("", "junit-*.xml", 7, "stale junit output"),
)

# The OTel sink is append-only and single-file: cap bytes, keep the recent tail.
TELEMETRY_FILE = "telemetry/events.jsonl"
TELEMETRY_MAX_BYTES = 8 * 1024 * 1024


def is_expired(mtime: float, now: float, max_age_days: int) -> bool:
    """True when `mtime` is strictly older than `max_age_days` before `now`. Pure."""
    return (now - mtime) > (max_age_days * SECONDS_PER_DAY)


def select_expired(
    logs_dir: Path, policy: Policy, now: float, protected: frozenset[str] = PROTECTED
) -> list[Path]:
    """Files under `logs_dir` that `policy` marks expired, minus protected names.

    Non-recursive on purpose: each policy names the one directory it governs, so a
    new subdirectory is never silently swept by a rule written for another.
    """
    target = logs_dir / policy.subdir if policy.subdir else logs_dir
    if not target.is_dir():
        return []
    return sorted(
        path
        for path in target.glob(policy.pattern)
        if path.is_file()
        and path.name not in protected
        and is_expired(path.stat().st_mtime, now, policy.max_age_days)
    )


def plan_prune(
    logs_dir: Path, now: float, policies: tuple[Policy, ...] = POLICIES
) -> list[tuple[Policy, list[Path]]]:
    """Pair each policy with the files it would delete. Pure w.r.t. the filesystem
    (it reads, never writes), so a dry run and a real run plan identically."""
    return [(policy, select_expired(logs_dir, policy, now)) for policy in policies]


def trim_to_tail(path: Path, max_bytes: int) -> int:
    """Truncate `path` to its last `max_bytes`, on a line boundary. Returns bytes freed.

    No-op (returns 0) when the file is missing or already within the cap. The tail
    is what matters for an append-only event log, and cutting at the first newline
    inside the window keeps every retained line parseable as JSON.
    """
    if not path.is_file():
        return 0
    size = path.stat().st_size
    if size <= max_bytes:
        return 0
    with path.open("rb") as handle:
        handle.seek(size - max_bytes)
        tail = handle.read()
    newline = tail.find(b"\n")
    if newline != -1:
        tail = tail[newline + 1 :]
    path.write_bytes(tail)
    return size - len(tail)


def format_summary(deleted: int, freed_bytes: int, dry_run: bool) -> str:
    """The single status line this script prints. Pure."""
    verb = "would remove" if dry_run else "removed"
    if not deleted and not freed_bytes:
        return "[prune-logs] logs/ within retention — nothing to do"
    return f"[prune-logs] {verb} {deleted} file(s), {freed_bytes / 1024 / 1024:.1f} MB freed"


def prune(
    logs_dir: Path = LOGS_DIR, *, now: float | None = None, dry_run: bool = False
) -> tuple[int, int]:
    """Apply every policy plus the telemetry cap. Returns (files deleted, bytes freed)."""
    if not logs_dir.is_dir():
        return (0, 0)
    now = time.time() if now is None else now

    deleted = 0
    freed = 0
    for _policy, paths in plan_prune(logs_dir, now):
        for path in paths:
            freed += path.stat().st_size
            deleted += 1
            if not dry_run:
                path.unlink()

    if not dry_run:
        freed += trim_to_tail(logs_dir / TELEMETRY_FILE, TELEMETRY_MAX_BYTES)

    return (deleted, freed)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Prune stale files from logs/.")
    parser.add_argument("--dry-run", action="store_true", help="report without deleting")
    parser.add_argument("--quiet", action="store_true", help="print only when something changed")
    args = parser.parse_args(argv)

    deleted, freed = prune(dry_run=args.dry_run)
    if not args.quiet or deleted or freed:
        print(format_summary(deleted, freed, args.dry_run))
    return 0


if __name__ == "__main__":
    sys.exit(main())
