#!/usr/bin/env python3
"""Extracts ERROR/WARNING lines from carameli.log (+ rotated backups), dedupes by
message, filters to the most recent window, and writes logs/log-errors.log.

Log files are never modified. The pure parsing/filtering functions are unit-tested
in `scripts/hooks/tests/test_extract_log_errors.py`.
"""
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
RUNTIME_DIR = REPO_ROOT / "logs" / "runtime"
MAIN_LOG = RUNTIME_DIR / "carameli.log"
ARTIFACT = REPO_ROOT / "logs" / "log-errors.log"
WINDOW_DAYS = 3

_TS_RE = re.compile(r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})")
_PREFIX_RE = re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} \| ")
_ERROR_RE = re.compile(r"\| ERROR\s+\|")
_WARNING_RE = re.compile(r"\| WARNING\s+\|")
_LINE_PREFIX_RE = re.compile(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} \|")
_TS_FMT = "%Y-%m-%d %H:%M:%S.%f"


def filter_traceback(raw_tb: list[str]) -> list[str]:
    """Keep Traceback header, first-party app/ frames (+code), and the final
    exception line; drop third-party frames."""
    out: list[str] = []
    k = 0
    n = len(raw_tb)
    while k < n:
        line = raw_tb[k]
        if re.match(r"^\s*Traceback \(most recent call last\)", line):
            out.append(f"  {line}")
            k += 1
            continue
        if re.match(r'^\s+File ".*[/\\]app[/\\]', line):  # first-party frame
            out.append(f"  {line}")
            k += 1
            if k < n and not re.match(r"^\s+File ", raw_tb[k]):
                if raw_tb[k].strip():
                    out.append(f"  {raw_tb[k]}")
                k += 1
            continue
        if re.match(r"^\s+File ", line):  # third-party frame -- skip frame + code
            k += 1
            if k < n and not re.match(r"^\s+File ", raw_tb[k]):
                k += 1
            continue
        if re.match(r"^[A-Za-z][\w.]*[\s:(]", line):  # final exception line
            out.append(f"  {line}")
            k += 1
            continue
        k += 1
    return out


def parse_log(lines: list[str], seen: set) -> list[dict]:
    """Parse one log file's lines into deduped ERROR/WARNING entries.

    Each entry is {timestamp, lines}. `seen` is mutated to dedupe across files.
    """
    entries: list[dict] = []
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        is_error = bool(_ERROR_RE.search(line))
        is_warning = bool(_WARNING_RE.search(line))
        if not (is_error or is_warning):
            i += 1
            continue

        ts_match = _TS_RE.match(line)
        ts = ts_match.group(1) if ts_match else ""
        key = _PREFIX_RE.sub("", line)
        added = key not in seen
        seen.add(key)

        # Collect continuation (traceback) lines until the next timestamped line.
        raw_tb: list[str] = []
        j = i + 1
        while j < n and not _LINE_PREFIX_RE.match(lines[j]):
            raw_tb.append(lines[j])
            j += 1
        i = j

        if added:
            entry_lines = [line]
            if is_error and raw_tb:
                entry_lines.extend(filter_traceback(raw_tb))
            entries.append({"timestamp": ts, "lines": entry_lines})
    return entries


def filter_window(entries: list[dict], window_days: int) -> list[dict]:
    """Keep entries within `window_days` of the latest timestamp (undated kept)."""
    timestamps = [e["timestamp"] for e in entries if e["timestamp"]]
    if not timestamps:
        return entries
    latest = datetime.strptime(max(timestamps), _TS_FMT)
    cutoff = latest - timedelta(days=window_days)
    out = []
    for e in entries:
        if not e["timestamp"] or datetime.strptime(e["timestamp"], _TS_FMT) >= cutoff:
            out.append(e)
    return out


def flatten(entries: list[dict]) -> list[str]:
    """Sort entries chronologically and flatten to a line list."""
    out: list[str] = []
    for entry in sorted(entries, key=lambda e: e["timestamp"]):
        out.extend(entry["lines"])
    return out


def collect_log_files() -> list[Path]:
    files = []
    if MAIN_LOG.exists():
        files.append(MAIN_LOG)
    for i in range(1, 6):
        rotated = MAIN_LOG.with_name(f"{MAIN_LOG.name}.{i}")
        if rotated.exists():
            files.append(rotated)
    return files


def main() -> int:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    print("\n=== Log Error Extraction ===")
    print(f"Source   : {MAIN_LOG} (+ rotated backups)")
    print(f"Artifact : {ARTIFACT}\n")

    log_files = collect_log_files()
    if not log_files:
        print("No log files found.")
        ARTIFACT.write_text("", encoding="utf-8")
        return 0

    seen: set = set()
    entries: list[dict] = []
    for f in log_files:
        entries.extend(parse_log(f.read_text(encoding="utf-8").splitlines(), seen))

    entries = filter_window(entries, WINDOW_DAYS)
    out_lines = flatten(entries)

    if not out_lines:
        print("No errors or warnings found.")
        ARTIFACT.write_text("", encoding="utf-8")
        return 0

    ARTIFACT.write_text("\n".join(out_lines) + "\n", encoding="utf-8")
    error_count = sum(1 for line in out_lines if _ERROR_RE.search(line))
    warning_count = sum(1 for line in out_lines if _WARNING_RE.search(line))
    print(f"  Errors   : {error_count}")
    print(f"  Warnings : {warning_count}")
    print(f"\nWritten to: {ARTIFACT}")
    print("  ERRORS EXTRACTED -- run /fix-logs")
    return 1


if __name__ == "__main__":
    sys.exit(main())
