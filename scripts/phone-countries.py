#!/usr/bin/env python3
"""Report which numbering plans this deployment's own numbers are in.

`frontend/phoneMetadata.ts` names the plans the comic-book skin ships *formats* for --
44 of libphonenumber's 245, the difference being 29.95 KB of the lazy skin chunk. Every
other plan is still recognised, so the list decides only whether a number is grouped as
it is typed, never what number it is. But a list chosen by opinion drifts from the
customers who actually exist, and the drift is invisible: nothing fails, some people's
numbers just stop being formatted.

This is the thing that settles it. It reads the numbers already in the database --
`phone_lines`, `call_events` and `sms_messages` -- resolves each to a calling code, and
prints the plans in use with counts, flagging any the frontend list does not carry.

    python scripts/phone-countries.py                 # report
    python scripts/phone-countries.py --check         # exit 1 if a plan in use is missing
    python scripts/phone-countries.py --min-count 25  # ignore the long tail

It needs a populated database, so it is a script you run rather than a gate: a CI job has
an empty one and would report that nothing is in use. Run it before editing the list and
put its answer in the commit message, which is the whole provenance the constant has.

**It reads numbers and prints country codes.** No number, or part of one, reaches the
output or any log -- see `report_lines`, where the aggregation happens before anything is
printed. That is deliberate: the answer to "which plans" is a histogram, and a histogram
of countries is not customer data even though the thing it was computed from is.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path
from typing import Iterable, Sequence

REPO_ROOT = Path(__file__).resolve().parent.parent
METADATA = REPO_ROOT / "frontend" / "node_modules" / "libphonenumber-js" / "metadata.min.json"
FRONTEND_LIST = REPO_ROOT / "frontend" / "phoneMetadata.ts"

# Every column holding a phone number, by table. `extension` is deliberately absent: an
# extension is an internal label, not a dialable number, and folding it in would report a
# numbering plan for '101'.
NUMBER_COLUMNS: dict[str, tuple[str, ...]] = {
    "phone_lines": ("phone_number",),
    "call_events": ("from_number", "to_number"),
    "sms_messages": ("from_number", "to_number"),
}


def calling_code_index(metadata: dict) -> dict[str, str]:
    """Calling code to the country it belongs to, longest code winning a prefix match.

    The map is code-to-*country* rather than the metadata's country-to-code because that
    is the direction a number is read in. Where several countries share a code -- `1` is
    the whole NANP -- the metadata lists the principal one first and that is the one
    taken, which is the same choice the parser makes for an ambiguous number.
    """
    return {code: names[0] for code, names in metadata["country_calling_codes"].items() if names}


def country_of(number: str, index: dict[str, str]) -> str | None:
    """The plan an E.164 number belongs to, or None when it is not one.

    Longest prefix first, because `1` and `1242` are both calling codes and the shorter
    one would otherwise claim every Bahamian number. Anything not written internationally
    is skipped rather than guessed at: a national number means nothing without knowing the
    plan already, which is the question being asked.
    """
    digits = number.strip()
    if not digits.startswith("+"):
        return None
    digits = digits[1:]
    for length in range(min(4, len(digits)), 0, -1):
        country = index.get(digits[:length])
        if country:
            return country
    return None


def formatted_countries(source: str) -> list[str]:
    """The codes in `FORMATTED_COUNTRIES`, read out of the frontend module.

    A regex over the array literal rather than a parser: the alternative is a second copy
    of the list in Python, and a second copy is the thing this script exists to prevent.
    The shape it depends on is a quoted two-letter code, which is all the module writes.
    """
    block = re.search(r"export const FORMATTED_COUNTRIES[^=]*=\s*\[(.*?)\]", source, re.DOTALL)
    if not block:
        return []
    return re.findall(r"'([A-Z]{2})'", block.group(1))


def tally(numbers: Iterable[str], index: dict[str, str]) -> Counter[str]:
    """Count plans across every number, ignoring what cannot be attributed."""
    counts: Counter[str] = Counter()
    for number in numbers:
        country = country_of(number, index)
        if country:
            counts[country] += 1
    return counts


def report_lines(
    counts: Counter[str], carried: Sequence[str], min_count: int
) -> tuple[list[str], list[str]]:
    """The printable report and the plans in use that `carried` does not format.

    Returns aggregates only. Nothing derived from an individual number survives past
    `tally`, which is what keeps a customer's number out of a terminal and a CI log.
    """
    missing = [c for c, n in counts.most_common() if n >= min_count and c not in carried]
    lines = [f"{len(counts)} plans in use across {sum(counts.values())} numbers", ""]
    lines += [
        f"  {country}  {n:>7}  {'formatted' if country in carried else 'TRIMMED'}"
        for country, n in counts.most_common()
    ]
    unused = [c for c in carried if c not in counts]
    if unused:
        lines += ["", f"formatted but unused ({len(unused)}): {' '.join(unused)}"]
    if missing:
        lines += [
            "",
            f"in use but not formatted ({len(missing)}): {' '.join(missing)}",
            "Add them to FORMATTED_COUNTRIES and run `npm run gen:phone-metadata`.",
        ]
    return lines, missing


def fetch_numbers(database_url: str) -> list[str]:
    """Every phone number in the tables that hold one.

    The identifiers are composed with `psycopg.sql` rather than interpolated into the
    string. They come from this module's own constant and could not be user input, so an
    f-string would be *safe* -- and would need a `# noqa: S608` saying so, which is a
    suppression the next reader has to evaluate and a linter that has learned to be
    ignored here. Composition makes the rule have nothing to say instead.

    `psycopg` is imported here rather than at module scope so that every pure function
    above, and its tests, run without the driver installed.
    """
    import psycopg
    from psycopg import sql

    query = sql.SQL("SELECT {column} FROM {table} WHERE {column} IS NOT NULL")
    numbers: list[str] = []
    with psycopg.connect(database_url) as conn, conn.cursor() as cur:
        for table, columns in NUMBER_COLUMNS.items():
            for column in columns:
                cur.execute(
                    query.format(column=sql.Identifier(column), table=sql.Identifier(table))
                )
                numbers += [row[0] for row in cur.fetchall()]
    return numbers


def database_url() -> str:
    """`DATABASE_URL` from the environment or `.env`, in psycopg's spelling."""
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        env = REPO_ROOT / ".env"
        if env.exists():
            for line in env.read_text(encoding="utf-8").splitlines():
                if line.startswith("DATABASE_URL="):
                    url = line.split("=", 1)[1].strip().strip("'\"")
    return url.replace("postgresql+asyncpg://", "postgresql://")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--check",
        action="store_true",
        help="exit 1 when a plan in use is not formatted by the frontend",
    )
    parser.add_argument(
        "--min-count",
        type=int,
        default=1,
        help="ignore plans with fewer numbers than this when deciding what is missing",
    )
    args = parser.parse_args(argv)

    url = database_url()
    if not url:
        print("No DATABASE_URL in the environment or .env -- nothing to read.", file=sys.stderr)
        return 2
    if not METADATA.exists():
        print(f"{METADATA} is missing; run python scripts/bootstrap.py.", file=sys.stderr)
        return 2

    index = calling_code_index(json.loads(METADATA.read_text(encoding="utf-8")))
    carried = formatted_countries(FRONTEND_LIST.read_text(encoding="utf-8"))
    counts = tally(fetch_numbers(url), index)
    lines, missing = report_lines(counts, carried, args.min_count)
    print("\n".join(lines))
    return 1 if args.check and missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
