#!/usr/bin/env python3
"""Regenerate .codex/hooks.json from .claude/settings.json's `hooks` block.

.claude/settings.json is the single source of truth for hook wiring. Codex reads
its hooks from .codex/hooks.json (a separate file, because a `hooks` block in
.agents/settings.json would double-fire alongside it -- see sync-agents-settings.py),
so this generator keeps that file in lock-step with Claude instead of hand-editing.

Full event parity: every event and matcher Claude wires is carried over. The only
transform is the command path -- Claude uses `${CLAUDE_PROJECT_DIR:-.}/<path>`,
Codex runs hooks from the repo root, so the prefix is stripped to a repo-relative
path. Claude-vs-Codex behavioural differences live in the shared hook scripts,
not the wiring: e.g. the CLAUDE_CODE_REMOTE guard in branch-per-task.py /
session-start.sh is simply inert under Codex because that env var is never set.
So no event is dropped here.

Invoked by scripts/sync-agents-context.py after the .agents mirror.

`to_codex_hooks` is pure and unit-tested
(scripts/hooks/tests/test_sync_codex_hooks.py).
"""

import json
import sys
from pathlib import Path

# Claude templates hook paths against this project-dir variable; Codex resolves
# hook commands from the repo root, so the prefix is dropped to a bare rel path.
CLAUDE_PROJECT_DIR_PREFIX = "${CLAUDE_PROJECT_DIR:-.}/"


def rewrite_command(command: str) -> str:
    """Turn a Claude hook command into its Codex form (repo-relative paths)."""
    return command.replace(CLAUDE_PROJECT_DIR_PREFIX, "")


def to_codex_hooks(claude_settings: dict) -> dict:
    """Build Codex's `{"hooks": ...}` payload from a Claude settings dict.

    Carries every event/matcher across unchanged except each command's
    project-dir prefix. A missing `hooks` block yields an empty one.
    """
    hooks = claude_settings.get("hooks", {})
    result: dict = {}
    for event, groups in hooks.items():
        new_groups = []
        for group in groups:
            new_group = dict(group)
            new_group["hooks"] = [
                {**h, "command": rewrite_command(h["command"])}
                if isinstance(h, dict) and isinstance(h.get("command"), str)
                else h
                for h in group.get("hooks", [])
            ]
            new_groups.append(new_group)
        result[event] = new_groups
    return {"hooks": result}


def sync(src: Path, dest: Path) -> int:
    """Write `src` settings' hooks to `dest` in Codex form. No-op if src missing."""
    if not src.exists():
        return 0
    data = json.loads(src.read_text(encoding="utf-8"))
    # newline='' keeps LF on Windows (the repo enforces eol=lf via .gitattributes).
    dest.write_text(json.dumps(to_codex_hooks(data), indent=2) + "\n", encoding="utf-8", newline="")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) >= 2:
        src, dest = Path(argv[0]), Path(argv[1])
    else:
        repo_root = Path(__file__).resolve().parent.parent
        src = repo_root / ".claude/settings.json"
        dest = repo_root / ".codex/hooks.json"
    return sync(src, dest)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
