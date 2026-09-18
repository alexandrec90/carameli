"""The Node pin must be coordinated, and must be new enough for the frontend lock.

`CLAUDE.md` names three files that have to agree about Node: `.nvmrc`, the `node-version`
of `.github/actions/setup-node-env/action.yml`, and the `frontend` service's image tag in
`docker-compose.yml`. A mismatch between them is the cheap failure -- a workstation and CI
disagreeing about an experimental global, which the vitest storage shim already absorbs.

The expensive failure is the one this file exists for, and it has no mismatch in it at
all: the pin is *behind the dependency tree*. `npm` does not enforce `engines`, so a bump
that raises a floor above the pin installs cleanly and then dies at the point of use --
cspell 10.3.0 needs Node >= 22.18 and the pin was 20, so `npm run lint`'s spelling step
could not run on the interpreter the repo told everyone to use, and it read as a broken
lint step rather than a stale pin. Checking the pin against the whole lock catches the
next one at the bump instead of at the next person's lint run.

Optional packages are excluded: the lock carries a platform-specific prebuilt for every
target (`@img/sharp-win32-ia32` declares `^20.9.0`), and npm skips the ones whose `os`/
`cpu` do not match, so their `engines` never constrain the runner or the workstation.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

NODE_VERSION = re.compile(r"^\s*node-version:\s*[\"']?(\d+)", re.MULTILINE)
NODE_IMAGE = re.compile(r"^\s*image:\s*node:(\d+)", re.MULTILINE)

# A pin like "24" means "whatever 24.x actions/setup-node resolves to", so the pin is
# tested as the newest conceivable release on that line. Anything else would read
# `^20.19.0` as unsatisfied by a pin of `20`, which is how CI has always resolved it.
_LINE_END = 1 << 30

Version = tuple[int, int, int]


def _parse_version(text: str) -> Version:
    """`v12.22.7`, `0.4` and `24` all become a comparable triple."""
    parts = text.strip().lstrip("v=").split(".")
    numbers = [int(re.match(r"\d+", part).group()) for part in parts if re.match(r"\d+", part)]
    numbers += [0] * (3 - len(numbers))
    return (numbers[0], numbers[1], numbers[2])


def _upper_bound(text: str, caret: bool) -> Version:
    """The exclusive ceiling `^`/`~` put on a (possibly partial) version."""
    cleaned = text.strip().lstrip("v=")
    parts = [part for part in cleaned.split(".") if part]
    major, minor, patch = _parse_version(cleaned)
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
            other = _parse_version(comparator[len(operator) :])
            if operator == ">=":
                return candidate >= other
            if operator == "<=":
                return candidate <= other
            if operator == ">":
                return candidate > other
            return candidate < other
    if comparator[0] in "^~":
        rest = comparator[1:]
        return _parse_version(rest) <= candidate < _upper_bound(rest, caret=comparator[0] == "^")
    # A bare `20` or `20.x` is that release line, which is what a pin names too.
    return _parse_version(comparator)[0] == candidate[0]


def satisfies(candidate: Version, node_range: str) -> bool:
    """Whether `candidate` is admitted by an npm `engines.node` range.

    Supports the forms the lockfile actually uses: `||` alternatives, space-separated
    comparators within one alternative, `^`/`~`, the four inequalities, bare release
    lines and `*`.
    """
    for alternative in node_range.split("||"):
        comparators = re.findall(r"(?:[<>]=?|[\^~])?\s*v?\d[\w.\-]*|\*", alternative)
        if comparators and all(
            _satisfies_comparator(candidate, comparator.replace(" ", ""))
            for comparator in comparators
        ):
            return True
    return False


def _pinned_major() -> int:
    return int((REPO / ".nvmrc").read_text(encoding="utf-8").strip())


def _pinned_candidate() -> Version:
    return (_pinned_major(), _LINE_END, _LINE_END)


def _engine_requirements() -> list[tuple[str, str]]:
    lock = json.loads((REPO / "frontend" / "package-lock.json").read_text(encoding="utf-8"))
    return [
        (name or "<root>", package["engines"]["node"])
        for name, package in lock["packages"].items()
        if not package.get("optional") and (package.get("engines") or {}).get("node")
    ]


def test_the_repo_pins_a_node_line() -> None:
    assert (REPO / ".nvmrc").exists(), (
        "no .nvmrc -- `nvm use` takes the workstation default and the vitest storage "
        "shim is the only thing standing between that and 46 red tests"
    )
    raw = (REPO / ".nvmrc").read_text(encoding="utf-8").strip()
    assert re.fullmatch(r"\d+", raw), (
        f"{raw!r} is not a bare release line -- `nvm use` reads this file verbatim, and a "
        "range or a `v` prefix is a failure at the point of use, not here"
    )


def test_the_pin_matches_the_ci_action() -> None:
    action = (REPO / ".github/actions/setup-node-env/action.yml").read_text(encoding="utf-8")
    match = NODE_VERSION.search(action)
    assert match, "setup-node-env names no node-version"
    assert int(match.group(1)) == _pinned_major(), (
        f".nvmrc pins {_pinned_major()} but setup-node-env sets up {match.group(1)} -- "
        "keep them in step so a workstation runs what the gate runs"
    )


def test_every_workflow_agrees_with_the_pin() -> None:
    """Including the disabled ones: a workflow re-enabled on a stale pin is a gate that
    installs the lock and then cannot run the tools in it."""
    pinned = _pinned_major()
    mismatched: dict[str, list[str]] = {}
    for path in sorted((REPO / ".github").rglob("*")):
        if not path.is_file() or path.suffix not in {".yml", ".yaml", ".disabled"}:
            continue
        found = NODE_VERSION.findall(path.read_text(encoding="utf-8"))
        off = sorted({version for version in found if int(version) != pinned})
        if off:
            mismatched[str(path.relative_to(REPO)).replace("\\", "/")] = off
    assert not mismatched, f"workflows off the Node {pinned} pin: {mismatched}"


def test_the_frontend_container_runs_the_pinned_node() -> None:
    compose = (REPO / "docker-compose.yml").read_text(encoding="utf-8")
    tags = {int(tag) for tag in NODE_IMAGE.findall(compose)}
    assert tags, "docker-compose.yml runs no node: image"
    assert tags == {_pinned_major()}, (
        f".nvmrc pins {_pinned_major()} but compose runs node:{sorted(tags)} -- the dev "
        "server and the host would disagree about the same node_modules"
    )


def test_npm_refuses_an_unsupported_interpreter_by_itself() -> None:
    """`frontend/.npmrc` is what makes `npm ci` the check rather than this file.

    Without `engine-strict`, npm downgrades every `engines` violation to an EBADENGINE
    warning in the install log and builds the tree anyway -- which is how the breakage
    this module exists for got in. The setting has to be committed to have any effect on
    CI or a fresh clone, and `.npmrc` is gitignored by default here (it is where a
    registry token lands), so the negation in `.gitignore` is load-bearing too: delete
    it and the file goes invisible without anything failing.
    """
    npmrc = REPO / "frontend" / ".npmrc"
    assert npmrc.exists(), "frontend/.npmrc is gone -- npm is back to warning and building"
    assert re.search(r"^engine-strict\s*=\s*true", npmrc.read_text("utf-8"), re.MULTILINE), (
        "frontend/.npmrc no longer sets engine-strict=true"
    )


def test_the_manifest_declares_the_pinned_line() -> None:
    """`engines.node` in package.json is the half `engine-strict` enforces for the repo
    itself, so a workstation on the wrong Node is refused at its own manifest rather
    than on whichever dependency happens to floor highest."""
    manifest = json.loads((REPO / "frontend" / "package.json").read_text(encoding="utf-8"))
    declared = (manifest.get("engines") or {}).get("node")
    assert declared, "frontend/package.json declares no engines.node"
    assert satisfies(_pinned_candidate(), declared), (
        f"package.json requires node {declared!r}, which .nvmrc's {_pinned_major()} "
        "does not satisfy"
    )
    assert not satisfies((_pinned_major() - 1, _LINE_END, _LINE_END), declared), (
        f"package.json's {declared!r} also admits Node {_pinned_major() - 1} -- it is "
        "floored below the pin, so the pinned line is not actually required"
    )


def test_the_pin_satisfies_every_locked_engine_constraint() -> None:
    """The reversion check for the cspell 10.3.0 breakage: put the pin back to 20 and
    cspell, jsdom, undici and twenty-odd others report themselves as unrunnable here."""
    candidate = _pinned_candidate()
    unsatisfied = {
        name: node_range
        for name, node_range in _engine_requirements()
        if not satisfies(candidate, node_range)
    }
    assert not unsatisfied, (
        f"Node {_pinned_major()} is below the floor of {len(unsatisfied)} locked "
        f"package(s): {dict(sorted(unsatisfied.items())[:5])} -- raise the pin or hold "
        "the dependency back; npm installs either way and fails at the point of use"
    )


def test_the_range_parser_reads_the_forms_the_lockfile_uses() -> None:
    """`satisfies` is the only part of this file that can be wrong quietly -- a parser
    that returned True for everything would make the check above vacuous."""
    assert satisfies((24, _LINE_END, _LINE_END), ">=22.18.0")
    assert not satisfies((20, _LINE_END, _LINE_END), ">=22.18.0")
    assert satisfies((20, _LINE_END, _LINE_END), "^20.19.0 || >=22.12.0")
    assert satisfies((24, _LINE_END, _LINE_END), "^22.22.2 || ^24.15.0 || >=26.0.0")
    assert not satisfies((23, _LINE_END, _LINE_END), "^22.22.2 || ^24.15.0 || >=26.0.0")
    assert satisfies((24, _LINE_END, _LINE_END), "18 || 20 || >=22")
    assert not satisfies((21, _LINE_END, _LINE_END), "18 || 20 || >=22")
    assert satisfies((24, _LINE_END, _LINE_END), ">= 0.4")
    assert satisfies((24, _LINE_END, _LINE_END), ">=v12.22.7")
    assert satisfies((24, _LINE_END, _LINE_END), "*")
    assert not satisfies((24, _LINE_END, _LINE_END), "^20.9.0")
    assert not satisfies((24, _LINE_END, _LINE_END), "<24.0.0")
    assert satisfies((24, _LINE_END, _LINE_END), "~24")
    assert _upper_bound("0.0.3", caret=True) == (0, 0, 4)
    assert _upper_bound("0.2.3", caret=True) == (0, 3, 0)
