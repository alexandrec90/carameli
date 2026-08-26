#!/usr/bin/env python3
"""Encode a comic-book master into the served tree and offer it in the editor.

Adding artwork to the comic-book skin is three steps, and two of them are easy to
get wrong in ways nothing reports until much later:

1. **Encode** the PNG master in `frontend/assets-src/comic-book/` to `.webp` in
   `frontend/public/comic-book/`, at the size it is displayed at rather than the
   master's. The masters are 1-6 MB and up to 2816px wide; the panels draw at
   roughly 700-900px.
2. **Register** the export in `PANEL_ASSETS`
   (`frontend/src/skins/comic-book/editor/assets.ts`). The editor's picture dropdown
   is a hand-written manifest because a browser cannot enumerate a served directory
   -- so an unregistered export is both unreachable from the editor and dead weight
   to `frontend/assetPolicy.test.ts`, which fails on a file in `public/` that no
   source references.
3. **Place** it in a panel. That is authoring work, done in the editor at `?edit=1`
   and saved into `editor/layoutConfig.ts`. This script does not do it, and a
   picture is legitimately unplaced for a while.

Steps 1 and 2 are what this automates, and the encoder call is the part worth having
in code rather than in prose. The `sharp-cli` line that lived in
`frontend/assets-src/comic-book/README.md` was that tool's pre-6 spelling long after
sharp-cli 6, and following it exits with `Unknown argument: webp` having written
nothing -- which reads as a broken image rather than as a stale command. There is a
second reason not to reach for that tool at all: `sharp-cli` is not a dependency of
this repo, so every invocation was an `npx --yes` fetch over the network, while
`sharp` itself *is* declared in `frontend/package.json` and sits in
`frontend/node_modules` already. {@link node_argv} calls that copy, and a test pins
the call.

What this replaces was worse than stale. `compress-comic-book-images.py` pointed
`compress-images.js` at `frontend/public/comic-book` -- the *served* tree -- and
rewrote whatever PNG it found there in place, at a fixed quality with no resize.
Operating on `public/` is precisely the mistake `assets-src/` exists to prevent, and
the one the README records as having shipped ~24 MB of PNG for months; a re-encode
that cannot resize also leaves the largest win in the directory on the table. Its
docstring advertised a VS Code task that has never existed.

Usage:

    python scripts/encode-comic-art.py conversation hand-notepad
    python scripts/encode-comic-art.py notepad --max-edge 1024 --label "Steno pad"

Notifications are a task-layer concern -- a VS Code task wraps this with
scripts/notify-wrap.py. Do not emit a toast from inside the script.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

REPO_ROOT = Path(__file__).resolve().parents[1]
FRONTEND = REPO_ROOT / "frontend"
MASTERS_DIR = FRONTEND / "assets-src" / "comic-book"
PUBLIC_DIR = FRONTEND / "public"
EXPORT_DIR = PUBLIC_DIR / "comic-book"
MANIFEST = FRONTEND / "src" / "skins" / "comic-book" / "editor" / "assets.ts"
ASSET_POLICY = FRONTEND / "assetPolicy.ts"
LOG_DIR = REPO_ROOT / "logs"
ARTIFACT = "encode-comic-art.log"

#: Longest edge to fit within, in px. The panels draw at roughly 700-900px wide, so
#: this still carries about 1.5x the pixels it can show -- deliberate headroom for a
#: high-DPI display, not an accident. `MAX_CONTENT_IMAGE_EDGE` in `assetPolicy.ts` is
#: the ceiling the suite enforces; this is the default, well below it.
DEFAULT_MAX_EDGE = 1408

#: WebP quality. What the shipped panel art was encoded at.
DEFAULT_QUALITY = 82

#: Extensions accepted as a master, in the order a bare name is resolved.
MASTER_EXTENSIONS = (".png", ".jpg", ".jpeg")

#: Fit the image inside a max-edge box rather than setting a width, so a portrait
#: master is bounded by its height. `hand-notepad.png` is taller than it is wide;
#: passing 1408 as a *width* would have made it 1408x2112 -- larger than the master's
#: own long edge and over `MAX_CONTENT_IMAGE_EDGE`. `withoutEnlargement` keeps a small
#: master from being upscaled into bytes that carry no detail.
NODE_PROGRAM = """
const sharp = require('sharp')
const [input, output, maxEdge, quality] = process.argv.slice(1)
sharp(input)
  .resize({
    width: Number(maxEdge),
    height: Number(maxEdge),
    fit: 'inside',
    withoutEnlargement: true,
  })
  .webp({ quality: Number(quality) })
  .toFile(output)
  .then(info => console.log(JSON.stringify({ width: info.width, height: info.height })))
  .catch(err => { console.error(err.message); process.exit(1) })
"""


class EncodeError(RuntimeError):
    """A failure worth reporting to the caller with a usable message."""


@dataclass(frozen=True)
class Master:
    """One master resolved to its source file and its intended export."""

    path: Path
    stem: str

    @property
    def export_name(self) -> str:
        return f"{self.stem}.webp"


def derive_label(stem: str) -> str:
    """A dropdown label from a file stem: `hand-notepad` -> `Hand notepad`.

    Deliberately dumb. The label is what an author reads in a `<select>`, and a
    generated one is a placeholder that says which file it is -- `--label` is there
    for when the picture deserves a name ("Two agents talking", not "Conversation2").
    """
    words = [w for w in re.split(r"[-_\s]+", stem.strip()) if w]
    if not words:
        raise EncodeError(f"cannot derive a label from {stem!r}")
    return " ".join([words[0].capitalize(), *(w.lower() for w in words[1:])])


def served_url(export_name: str) -> str:
    """The URL the browser requests an export by, percent-encoded.

    Some of this directory's filenames contain a space (`rotary phone.webp`), and the
    manifest stores the encoded spelling because that is what an `<img src>` needs.
    `assetPolicy.ts` decodes before comparing against the directory listing.
    """
    return f"/comic-book/{quote(export_name)}"


def resolve_master(name: str, masters_dir: Path | None = None) -> Master:
    """Find the master for `name`, with or without an extension.

    Refuses a path rather than a name: a master that is not in `assets-src/` is not a
    master, and quietly encoding one from elsewhere is how the only lossless copy ends
    up living in somebody's Downloads folder.

    `masters_dir` defaults late rather than in the signature: a default argument binds
    at import, so `MASTERS_DIR` in the signature would make a test that patches it
    reach the real `assets-src/` -- and from there `run` writes real exports and a real
    manifest line. That is not hypothetical; it happened while writing these tests.
    """
    masters_dir = masters_dir or MASTERS_DIR
    if "/" in name or "\\" in name:
        raise EncodeError(
            f"{name!r} looks like a path. Name a file in {masters_dir.name}/ instead, "
            "with or without its extension -- masters live there and nowhere else."
        )

    candidate = masters_dir / name
    if candidate.suffix.lower() in MASTER_EXTENSIONS and candidate.is_file():
        return Master(candidate, candidate.stem)

    for ext in MASTER_EXTENSIONS:
        candidate = masters_dir / f"{name}{ext}"
        if candidate.is_file():
            return Master(candidate, name)

    raise EncodeError(
        f"no master named {name!r} in {masters_dir}. Put the lossless original there "
        "first -- it is the only copy, and re-encoding a .webp from a .webp compounds "
        "the loss."
    )


def all_masters(masters_dir: Path | None = None) -> list[Master]:
    """Every master in the directory, sorted.

    What a no-argument run acts on, which is what makes a one-click task possible: an
    existing export is skipped unless `--force`, so "encode everything" costs one node
    call per *new* picture and nothing for the rest.

    Defaults late, for the reason {@link resolve_master} spells out.
    """
    masters_dir = masters_dir or MASTERS_DIR
    if not masters_dir.is_dir():
        return []
    return [
        Master(path, path.stem)
        for path in sorted(masters_dir.iterdir())
        if path.is_file() and path.suffix.lower() in MASTER_EXTENSIONS
    ]


def node_argv(master: Path, export: Path, max_edge: int, quality: int) -> list[str]:
    """The encoder call, as argv, to be run with `frontend/` as the cwd.

    `sharp` is a declared dependency of `frontend/package.json`, so this resolves out
    of `frontend/node_modules` with no install step and no network. Pinned by a test
    because the invocation this replaces went stale in prose and nothing caught it.
    """
    return [
        "node",
        "-e",
        NODE_PROGRAM,
        str(master),
        str(export),
        str(max_edge),
        str(quality),
    ]


def manifest_line(url: str, label: str) -> str:
    """One `PANEL_ASSETS` entry, formatted the way the file already formats them."""
    if "'" in label:
        raise EncodeError(f"label {label!r} contains a quote; pick one without.")
    return f"  {{ src: '{url}', label: '{label}' }},"


def register_in_manifest(source: str, url: str, label: str) -> tuple[str, bool]:
    """Append an entry to `PANEL_ASSETS`, returning the text and whether it changed.

    Idempotent on `src`: re-encoding a picture must not append a second line naming
    the same file, and `assetPolicy.test.ts`'s duplicate check would fail if it did. A
    label change on an already-registered picture is left alone -- renaming something
    an author chose is not this script's call.
    """
    if f"src: '{url}'" in source:
        return source, False

    marker = "export const PANEL_ASSETS: PanelAsset[] = ["
    start = source.find(marker)
    if start == -1:
        raise EncodeError(
            f"no PANEL_ASSETS array in {MANIFEST.name}. If it was renamed, this script "
            "and frontend/assetPolicy.test.ts both need to learn the new name."
        )

    end = source.find("\n]", start)
    if end == -1:
        raise EncodeError(f"PANEL_ASSETS in {MANIFEST.name} is not closed by a `]`.")

    return source[:end] + "\n" + manifest_line(url, label) + source[end:], True


def read_max_public_bytes(source: str) -> int:
    """`MAX_PUBLIC_BYTES` from `assetPolicy.ts`, in bytes.

    Parsed rather than duplicated. A second copy of a budget is a budget that
    disagrees with itself the first time either is edited, and reporting against the
    real one is this script's last act.
    """
    match = re.search(r"export const MAX_PUBLIC_BYTES\s*=\s*([\d_]+)\s*\*\s*1024", source)
    if not match:
        raise EncodeError(
            f"no MAX_PUBLIC_BYTES in {ASSET_POLICY.name}; cannot report the served-tree "
            "budget. Check whether the constant was renamed."
        )
    return int(match.group(1).replace("_", "")) * 1024


def public_tree_bytes(public_dir: Path) -> int:
    """Every byte under `public/` -- Vite copies the tree into `dist/` verbatim."""
    return sum(p.stat().st_size for p in public_dir.rglob("*") if p.is_file())


def budget_report(total: int, cap: int) -> tuple[str, bool]:
    """A line about the served tree against its cap, and whether it is over.

    Over-budget is reported, never fixed. Raising `MAX_PUBLIC_BYTES` is a decision
    about what every visitor downloads, and the reason that constant is a one-line
    diff in a file full of prose is so the decision reads as one in review. A script
    that quietly bumped it would delete exactly the signal it exists for.
    """
    kb = f"{total / 1024:,.1f} KB against a {cap / 1024:,.0f} KB budget"
    if total <= cap:
        return f"public/ is {kb} ({(cap - total) / 1024:,.1f} KB spare).", False
    need = -(-total // 1024)  # ceil to the next whole KB
    return (
        f"public/ is {kb} -- OVER.\n"
        "  frontend/assetPolicy.test.ts will fail. Either re-encode smaller (a lower\n"
        "  --max-edge or --quality is the cheap fix), or raise the cap deliberately:\n"
        f"    export const MAX_PUBLIC_BYTES = {need + 50:_} * 1024\n"
        "  and say in the commit message what the extra bytes buy.",
        True,
    )


def encode(master: Master, export: Path, max_edge: int, quality: int) -> tuple[int, int]:
    """Encode one master, returning the exported dimensions in px."""
    if shutil.which("node") is None:
        raise EncodeError(
            "node is not on PATH, so sharp cannot run. Check that the Node install the "
            "frontend uses is on this shell's PATH."
        )
    if not (FRONTEND / "node_modules" / "sharp").is_dir():
        raise EncodeError(
            "frontend/node_modules/sharp is missing. Run `npm --prefix frontend ci` "
            "first -- sharp is a declared dependency, so nothing else needs installing."
        )

    argv = node_argv(master.path, export, max_edge, quality)
    result = subprocess.run(argv, capture_output=True, text=True, cwd=FRONTEND)
    if result.returncode != 0:
        raise EncodeError(f"sharp failed for {master.path.name}:\n{result.stdout}{result.stderr}")
    try:
        info = json.loads(result.stdout.strip().splitlines()[-1])
        return int(info["width"]), int(info["height"])
    except (ValueError, KeyError, IndexError) as exc:
        raise EncodeError(
            f"sharp wrote {export.name} but its report was unreadable ({exc}):\n{result.stdout}"
        ) from exc


def write_artifact(text: str) -> Path:
    """Persist a failure where an agent can read it, per the failure-artifact rule."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    path = LOG_DIR / ARTIFACT
    path.write_text(text, encoding="utf-8")
    return path


def clear_artifact() -> None:
    """Empty the artifact on success, so a stale failure is never read as current."""
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    (LOG_DIR / ARTIFACT).write_text("", encoding="utf-8")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Encode a comic-book master to .webp and offer it in the editor.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Placing the picture in a panel is a separate, manual step: open the app\n"
            "with ?edit=1, select a panel, + Image, then pick it from the dropdown."
        ),
    )
    parser.add_argument(
        "names",
        nargs="*",
        metavar="MASTER",
        help="file name in frontend/assets-src/comic-book/, with or without extension; "
        "omit to encode every master that has no export yet",
    )
    parser.add_argument(
        "--max-edge",
        type=int,
        default=DEFAULT_MAX_EDGE,
        help=f"longest edge to fit within, in px (default: {DEFAULT_MAX_EDGE})",
    )
    parser.add_argument(
        "--quality",
        type=int,
        default=DEFAULT_QUALITY,
        help=f"WebP quality, 1-100 (default: {DEFAULT_QUALITY})",
    )
    parser.add_argument(
        "--label",
        help="dropdown label; only with a single MASTER (default: from the file name)",
    )
    parser.add_argument(
        "--no-register",
        action="store_true",
        help="encode only, leaving PANEL_ASSETS alone (the export then fails "
        "assetPolicy.test.ts as dead weight until something references it)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="re-encode over an existing .webp",
    )
    return parser


def run(args: argparse.Namespace) -> str:
    """Do the work, returning the report. Raises {@link EncodeError} on failure."""
    if args.label and len(args.names) != 1:
        raise EncodeError("--label takes a single MASTER; name one, or drop the flag.")
    if not 1 <= args.quality <= 100:
        raise EncodeError(f"--quality must be 1-100, got {args.quality}.")
    if args.max_edge < 1:
        raise EncodeError(f"--max-edge must be positive, got {args.max_edge}.")

    masters = [resolve_master(name) for name in args.names] if args.names else all_masters()
    if not masters:
        raise EncodeError(
            f"no masters in {MASTERS_DIR}. Put the lossless original there first -- "
            "it is the only copy, and nothing else in the repo keeps one."
        )
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)

    lines: list[str] = []
    for master in masters:
        export = EXPORT_DIR / master.export_name
        if export.exists() and not args.force:
            lines.append(f"SKIP  {master.export_name} already exists (--force to redo)")
        else:
            width, height = encode(master, export, args.max_edge, args.quality)
            size = export.stat().st_size / 1024
            lines.append(f"OK    {master.export_name}  {width}x{height}  {size:,.1f} KB")

        if args.no_register:
            continue

        label = args.label or derive_label(master.stem)
        source = MANIFEST.read_text(encoding="utf-8")
        updated, changed = register_in_manifest(source, served_url(master.export_name), label)
        if changed:
            MANIFEST.write_text(updated, encoding="utf-8")
            lines.append(f"      registered as '{label}' in {MANIFEST.name}")
        else:
            lines.append(f"      already in {MANIFEST.name}")

    cap = read_max_public_bytes(ASSET_POLICY.read_text(encoding="utf-8"))
    report, over = budget_report(public_tree_bytes(PUBLIC_DIR), cap)
    lines.extend(["", report])
    if over:
        raise EncodeError("\n".join(lines))
    lines.append("Place it in a panel from the editor: ?edit=1 -> select a panel -> + Image.")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        report = run(args)
    except EncodeError as exc:
        text = str(exc)
        print(text, file=sys.stderr)
        print(f"\nWritten to: {write_artifact(text)}", file=sys.stderr)
        return 1
    print(report)
    clear_artifact()
    return 0


if __name__ == "__main__":
    sys.exit(main())
