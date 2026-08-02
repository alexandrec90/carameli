#!/usr/bin/env python3
"""Clone the functional barebone skin and register a new Carameli skin."""

from __future__ import annotations

import argparse
import re
import shutil
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
SKINS = REPO_ROOT / "frontend/src/skins"
REGISTRY = SKINS / "registry.ts"
SWITCHER = REPO_ROOT / "frontend/src/components/SkinSwitcher.tsx"
NAME_RE = re.compile(r"^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$")


def _replace_once(text: str, needle: str, replacement: str, path: Path) -> str:
    if text.count(needle) != 1:
        raise ValueError(f"expected one registry anchor in {path}: {needle!r}")
    return text.replace(needle, replacement, 1)


def render_registry(text: str, name: str) -> str:
    text = _replace_once(
        text,
        "] as const\nexport type SkinName",
        f", '{name}'] as const\nexport type SkinName",
        REGISTRY,
    )
    text = _replace_once(
        text,
        "  'comic-book': () => import('./comic-book'),\n}",
        f"  'comic-book': () => import('./comic-book'),\n  '{name}': () => import('./{name}'),\n}}",
        REGISTRY,
    )
    config = (
        f"  '{name}': {{\n"
        "    background: '#ffffff',\n"
        "    text: 'Loading…',\n"
        "    textStyle: { fontFamily: 'sans-serif', fontSize: '18px', color: '#333' },\n"
        "  },\n"
    )
    return _replace_once(
        text,
        "}\n\nexport const DEFAULT_SKIN",
        f"{config}}}\n\nexport const DEFAULT_SKIN",
        REGISTRY,
    )


def render_switcher(text: str, name: str, label: str) -> str:
    return _replace_once(
        text,
        "  'comic-book': 'Comic Book',\n}",
        f"  'comic-book': 'Comic Book',\n  '{name}': '{label}',\n}}",
        SWITCHER,
    )


def scaffold(name: str, label: str, *, dry_run: bool = False) -> list[Path]:
    if not NAME_RE.fullmatch(name):
        raise ValueError("skin name must be lowercase kebab-case")
    source = SKINS / "barebone"
    target = SKINS / name
    if target.exists():
        raise FileExistsError(f"skin already exists: {target}")

    registry = render_registry(REGISTRY.read_text(encoding="utf-8"), name)
    switcher = render_switcher(SWITCHER.read_text(encoding="utf-8"), name, label)
    planned = [target, REGISTRY, SWITCHER]
    if dry_run:
        return planned

    shutil.copytree(source, target)
    for path in target.rglob("*"):
        if not path.is_file() or path.suffix not in {".ts", ".tsx", ".css"}:
            continue
        text = path.read_text(encoding="utf-8")
        path.write_text(
            text.replace("Barebone", label).replace("barebone", name),
            encoding="utf-8",
            newline="\n",
        )
    REGISTRY.write_text(registry, encoding="utf-8", newline="\n")
    SWITCHER.write_text(switcher, encoding="utf-8", newline="\n")
    return planned


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("name")
    parser.add_argument("label")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    for path in scaffold(args.name, args.label, dry_run=args.dry_run):
        print(path.relative_to(REPO_ROOT))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
