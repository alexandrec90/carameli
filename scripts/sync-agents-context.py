#!/usr/bin/env python3
"""Syncs CLAUDE.md -> AGENTS.md (all subdirs) and .claude/ -> .agents/.

CLAUDE.md / .claude/ are the source of truth; run this after editing them.

  1. Copy every CLAUDE.md to AGENTS.md in the same directory.
  2. Purge orphaned AGENTS.md (no sibling CLAUDE.md) -- AGENTS.md is derived.
  3. Mirror .claude/ -> .agents/ (copy new/changed, remove orphans), excluding
     settings.json (it carries a hooks block that must never reach .agents).
  4. Regenerate .agents/settings.json from .claude/settings.json with hooks
     stripped (via sync-agents-settings.py).

The pure tree helpers are unit-tested in
`scripts/hooks/tests/test_sync_agents_context.py`.
"""
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
PRUNE_DIRS = {".git", "node_modules", ".venv", "__pycache__"}


def iter_files(root: Path):
    """Yield files under root, skipping PRUNE_DIRS anywhere in the tree."""
    for path in root.rglob("*"):
        if path.is_file() and not (PRUNE_DIRS & set(path.parts)):
            yield path


def sync_claude_md(root: Path) -> tuple[int, int]:
    """Copy CLAUDE.md -> AGENTS.md everywhere; purge orphan AGENTS.md. (copied, deleted)."""
    copied = deleted = 0
    for claude in iter_files(root):
        if claude.name == "CLAUDE.md":
            shutil.copyfile(claude, claude.with_name("AGENTS.md"))
            copied += 1
    for agents in iter_files(root):
        if agents.name == "AGENTS.md" and not agents.with_name("CLAUDE.md").exists():
            agents.unlink()
            deleted += 1
    return copied, deleted


def mirror_tree(src: Path, dest: Path, exclude_names=frozenset()) -> None:
    """Mirror src -> dest like `robocopy /MIR`: copy new/changed, delete orphans.

    Files named in `exclude_names` are neither copied nor deleted (caller owns them).
    """
    dest.mkdir(parents=True, exist_ok=True)
    src_rel = {p.relative_to(src) for p in src.rglob("*") if p.is_file()
               and p.name not in exclude_names}

    # Copy new/changed files.
    for rel in src_rel:
        target = dest / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src / rel, target)

    # Delete orphan files (present in dest, absent in src).
    for path in list(dest.rglob("*")):
        if (path.is_file() and path.name not in exclude_names
                and path.relative_to(dest) not in src_rel):
            path.unlink()

    # Remove now-empty directories (deepest first).
    for path in sorted((p for p in dest.rglob("*") if p.is_dir()),
                       key=lambda p: len(p.parts), reverse=True):
        if not any(path.iterdir()):
            path.rmdir()


def main() -> int:
    copied, deleted = sync_claude_md(REPO_ROOT)
    print(f"  CLAUDE.md -> AGENTS.md: {copied} copied, {deleted} orphan(s) deleted")

    claude_dir = REPO_ROOT / ".claude"
    agents_dir = REPO_ROOT / ".agents"
    if not claude_dir.exists():
        print("  skipped  .claude/ (not found)")
        return 0

    mirror_tree(claude_dir, agents_dir, exclude_names={"settings.json"})
    print("  mirrored .claude/ -> .agents/ (settings.json excluded)")

    claude_settings = claude_dir / "settings.json"
    if claude_settings.exists():
        result = subprocess.run(
            [sys.executable, str(REPO_ROOT / "scripts" / "sync-agents-settings.py"),
             str(claude_settings), str(agents_dir / "settings.json")],
            cwd=REPO_ROOT,
        )
        if result.returncode != 0:
            print("sync-agents-settings.py failed", file=sys.stderr)
            return 1
        print("  regenerated .agents/settings.json (hooks stripped)")

    print("\nDone.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
