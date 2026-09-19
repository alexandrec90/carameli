#!/usr/bin/env python3
"""Which Node lines this repo's dependency tree will actually run on.

The pin in `.nvmrc` is not free to sit still and not free to move arbitrarily. It has a
floor -- `npm` records an `engines.node` for most packages, and a bump that raises one
above the pin takes out whatever tool runs next (cspell 10.3.0 did exactly that) -- and
it has a ceiling, because a package may name an upper bound the newest release breaks.
Both are in `frontend/package-lock.json`, and this module is the one implementation that
reads them.

One implementation on purpose. `tests/unit/test_node_version_pin.py` asserts the current
pin clears every constraint; `scripts/check-node-pin.py` asks the same question of a
*candidate* line before proposing a move. Two copies of a range parser is two answers to
"can we run on 26", and the one that disagrees is whichever nobody exercised.

Optional packages are excluded. A lock carries a prebuilt for every platform
(`@img/sharp-win32-ia32` declares `^20.9.0`), npm skips the ones whose `os`/`cpu` do not
match, and their engines never constrain a machine that never installs them.

stdlib only, pure functions, no I/O beyond reading the lock the caller names.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
LOCKFILE = "frontend/package-lock.json"
PIN_FILE = ".nvmrc"

# A pin names a release line, not a release: `actions/setup-node` with "24" installs
# that line's newest patch. So a line is tested as the newest version it could ever
# hold -- anything else reads `^20.19.0` as unsatisfied by a pin of `20`, which is the
# opposite of how every install of it has ever resolved.
LINE_END = 1 << 30

Version = tuple[int, int, int]


def parse_version(text: str) -> Version:
    """`v12.22.7`, `0.4` and `24` all become a comparable triple. Pure."""
    parts = text.strip().lstrip("v=").split(".")
    numbers = [int(re.match(r"\d+", part).group()) for part in parts if re.match(r"\d+", part)]
    numbers += [0] * (3 - len(numbers))
    return (numbers[0], numbers[1], numbers[2])


def line(major: int) -> Version:
    """The candidate version for a release line: its newest conceivable patch."""
    return (major, LINE_END, LINE_END)


def upper_bound(text: str, caret: bool) -> Version:
    """The exclusive ceiling `^`/`~` put on a (possibly partial) version. Pure."""
    cleaned = text.strip().lstrip("v=")
    parts = [part for part in cleaned.split(".") if part]
    major, minor, patch = parse_version(cleaned)
    if caret:
        if major:
            return (major + 1, 0, 0)
        # Below 1.0.0 every place is breaking: ^0.2.3 is <0.3.0, ^0.0.3 is <0.0.4.
        if minor or len(parts) < 3:
            return (0, minor + 1, 0) if len(parts) > 1 else (1, 0, 0)
        return (0, 0, patch + 1)
    return (major, minor + 1, 0) if len(parts) > 1 else (major + 1, 0, 0)


def _satisfies_comparator(candidate: Version, comparator: str) -> bool:
    comparator = comparator.strip()
    if not comparator or comparator in {"*", "x"}:
        return True
    for operator in (">=", "<=", ">", "<"):
        if comparator.startswith(operator):
            other = parse_version(comparator[len(operator) :])
            if operator == ">=":
                return candidate >= other
            if operator == "<=":
                return candidate <= other
            if operator == ">":
                return candidate > other
            return candidate < other
    if comparator[0] in "^~":
        rest = comparator[1:]
        return parse_version(rest) <= candidate < upper_bound(rest, caret=comparator[0] == "^")
    # A bare `20` or `20.x` is that release line, which is what a pin names too.
    return parse_version(comparator)[0] == candidate[0]


def satisfies(candidate: Version, node_range: str) -> bool:
    """Whether `candidate` is admitted by an npm `engines.node` range. Pure.

    Supports the forms a lockfile uses: `||` alternatives, space-separated comparators
    within one alternative, `^`/`~`, the four inequalities, bare release lines and `*`.
    """
    for alternative in node_range.split("||"):
        comparators = re.findall(r"(?:[<>]=?|[\^~])?\s*v?\d[\w.\-]*|\*", alternative)
        if comparators and all(
            _satisfies_comparator(candidate, comparator.replace(" ", ""))
            for comparator in comparators
        ):
            return True
    return False


def pinned_major(root: Path = REPO_ROOT) -> int:
    """The release line `.nvmrc` names."""
    return int((root / PIN_FILE).read_text(encoding="utf-8").strip())


def engine_constraints(root: Path = REPO_ROOT) -> list[tuple[str, str]]:
    """`(package, engines.node)` for every non-optional package in the lock."""
    lock = json.loads((root / LOCKFILE).read_text(encoding="utf-8"))
    return [
        (name or "<root>", package["engines"]["node"])
        for name, package in lock["packages"].items()
        if not package.get("optional") and (package.get("engines") or {}).get("node")
    ]


def unsatisfied(major: int, constraints: list[tuple[str, str]]) -> dict[str, str]:
    """Which of `constraints` a given release line would not satisfy. Pure.

    Empty means the tree runs there. Non-empty is the whole argument against a move, and
    names the packages rather than just refusing.
    """
    candidate = line(major)
    return {
        name: node_range for name, node_range in constraints if not satisfies(candidate, node_range)
    }
