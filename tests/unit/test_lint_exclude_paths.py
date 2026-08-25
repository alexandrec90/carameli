"""Every path the linters are told to skip must actually exist.

A lint or type-check exclusion is a claim that some real directory in this repo holds
code the tool must not look at. When that directory is deleted and the exclusion is
left behind, nothing fails: ruff and mypy both accept an exclude that matches nothing.
The dead entry then reads as policy -- the next agent sees `extend-exclude` naming a
tree, assumes the tree is somewhere, and works around its absence.

That is not hypothetical. `ruff.toml` and `mypy.ini` both excluded `evals/fixtures`
for weeks after commit dd7efc5 removed the whole `evals/` harness, and the only reason
anyone noticed was an unrelated audit of stranded files.

Scope is deliberately the lint/type excludes only, not `.gitignore`: an ignore rule
legitimately names paths that do not exist yet (build output, caches, local overrides),
so the same assertion there would be wrong rather than merely noisy.
"""

from __future__ import annotations

import configparser
import re
import tomllib
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]

# Chars that make a mypy `exclude` entry a pattern rather than a literal path. Splitting
# on the first of these yields the fixed prefix every match must start with, which is
# what we can check for existence.
_REGEX_META = re.compile(r"[\\\[\](){}|?*+.^$]")

# Same idea for ruff, whose excludes are gitignore-style globs rather than regexes.
_GLOB_META = re.compile(r"[\[\]*?!]")


def _ruff_excludes() -> list[str]:
    """`exclude` + `extend-exclude` from ruff.toml, in file order."""
    data = tomllib.loads((REPO_ROOT / "ruff.toml").read_text(encoding="utf-8"))
    return [*data.get("exclude", []), *data.get("extend-exclude", [])]


def _mypy_excludes() -> list[str]:
    """The `exclude` entries from mypy.ini; the key accepts one regex per line."""
    parser = configparser.ConfigParser(interpolation=None)
    parser.read(REPO_ROOT / "mypy.ini", encoding="utf-8")
    raw = parser.get("mypy", "exclude", fallback="")
    return [line.strip() for line in raw.splitlines() if line.strip()]


def literal_prefix(entry: str, meta: re.Pattern[str]) -> str:
    """The fixed leading path of a pattern -- '' when it starts with a metacharacter.

    `^evals/fixtures/` -> `evals/fixtures`. A pattern whose very first character is a
    metacharacter has no anchored prefix to check, and is reported rather than skipped:
    an exclusion nobody can trace to a directory is the problem this module is about.
    """
    body = entry.lstrip("^").rstrip("$")
    return meta.split(body, maxsplit=1)[0].strip("/")


def _assert_excludes_resolve(entries: list[str], meta: re.Pattern[str], source: str) -> None:
    for entry in entries:
        prefix = literal_prefix(entry, meta)
        assert prefix, f"{source} excludes {entry!r}, which names no traceable path"
        assert (REPO_ROOT / prefix).exists(), (
            f"{source} excludes {entry!r} but {prefix} does not exist. "
            f"Delete the exclusion or restore the directory -- a rule that matches "
            f"nothing is dead config that reads as policy."
        )


def test_ruff_excludes_name_paths_that_exist() -> None:
    _assert_excludes_resolve(_ruff_excludes(), _GLOB_META, "ruff.toml")


def test_mypy_excludes_name_paths_that_exist() -> None:
    _assert_excludes_resolve(_mypy_excludes(), _REGEX_META, "mypy.ini")


def test_literal_prefix_extracts_the_anchored_directory() -> None:
    assert literal_prefix("^evals/fixtures/", _REGEX_META) == "evals/fixtures"
    assert literal_prefix("app/generated/.*", _REGEX_META) == "app/generated"
    assert literal_prefix("evals/fixtures", _GLOB_META) == "evals/fixtures"
    assert literal_prefix("**/vendor", _GLOB_META) == ""


def test_a_dead_exclusion_is_reported() -> None:
    """The reversion guard: re-adding the removed entry must fail, not pass quietly."""
    with pytest.raises(AssertionError, match="does not exist"):
        _assert_excludes_resolve(["^evals/fixtures/"], _REGEX_META, "mypy.ini")
