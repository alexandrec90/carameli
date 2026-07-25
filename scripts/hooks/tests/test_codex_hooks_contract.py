"""Repository-level contract tests for generated Codex hook wiring."""

import json
import re
from pathlib import Path

from conftest import load_module

hook = load_module("scripts/sync-codex-hooks.py")

REPO_ROOT = Path(__file__).resolve().parents[3]
CLAUDE_SETTINGS = REPO_ROOT / ".claude/settings.json"
CODEX_HOOKS = REPO_ROOT / ".codex/hooks.json"
EXPECTED_DROPPED_EVENTS = frozenset({"PostToolUseFailure"})
EXPECTED_DROPPED_MATCHERS = frozenset({("PostToolUse", "^Skill$")})
EXPECTED_TOPOLOGY = {
    "SessionStart": (
        (
            "",
            (
                (
                    "scripts/hooks/codex-hook-adapter.py",
                    "scripts/hooks/codex-session-start.py",
                ),
            ),
        ),
    ),
    "UserPromptSubmit": (
        (
            "",
            (
                (
                    "scripts/hooks/codex-hook-adapter.py",
                    "scripts/hooks/branch-per-task.py",
                ),
            ),
        ),
    ),
    "PreToolUse": (
        (
            "Bash",
            (
                (
                    "scripts/hooks/codex-hook-adapter.py",
                    "scripts/hooks/enforce-capped-bash.py",
                ),
            ),
        ),
        (
            ".*",
            (
                (
                    "scripts/hooks/codex-hook-adapter.py",
                    "scripts/hooks/pretool.py",
                ),
            ),
        ),
    ),
    "PostToolUse": (
        (
            "^(Edit|Write|MultiEdit|apply_patch|create_file)$",
            (
                (
                    "scripts/hooks/codex-hook-adapter.py",
                    ".claude/skills/add-db-model/after-model-edit.py",
                ),
                (
                    "scripts/hooks/codex-hook-adapter.py",
                    "scripts/hooks/lint-fix.py",
                ),
            ),
        ),
    ),
    "Stop": (
        (
            "",
            (
                (
                    "scripts/hooks/codex-hook-adapter.py",
                    "scripts/hooks/stop.py",
                ),
            ),
        ),
    ),
}


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _repo_paths(command: str) -> tuple[str, ...]:
    return tuple(re.findall(r"\$\(git rev-parse --show-toplevel\)/([^\"]+)", command))


def _topology(payload: dict) -> dict:
    return {
        event: tuple(
            (
                group.get("matcher", ""),
                tuple(_repo_paths(entry["command"]) for entry in group["hooks"]),
            )
            for group in groups
        )
        for event, groups in payload["hooks"].items()
    }


def test_checked_in_codex_hooks_match_real_claude_settings():
    """The mandatory test and mirror gate both reject stale generated wiring."""
    generated = hook.to_codex_hooks(_load_json(CLAUDE_SETTINGS))

    assert _load_json(CODEX_HOOKS) == generated


def test_real_hook_drops_are_explicitly_allowlisted():
    """New unsupported events or dead matchers must get a deliberate review."""
    source = _load_json(CLAUDE_SETTINGS)
    generated = hook.to_codex_hooks(source)

    dropped_events = frozenset(source["hooks"]) - frozenset(generated["hooks"])
    source_matchers = {
        (event, group.get("matcher", ""))
        for event, groups in source["hooks"].items()
        if event in hook.SUPPORTED_EVENTS
        for group in groups
    }
    generated_matchers = {
        (event, group.get("matcher", ""))
        for event, groups in generated["hooks"].items()
        for group in groups
    }

    assert hook.UNSUPPORTED_EVENTS == EXPECTED_DROPPED_EVENTS
    assert hook.UNSUPPORTED_MATCHERS == EXPECTED_DROPPED_MATCHERS
    assert dropped_events == EXPECTED_DROPPED_EVENTS
    assert source_matchers - generated_matchers == EXPECTED_DROPPED_MATCHERS


def test_current_hook_topology_requires_compatibility_review():
    """Any real event, matcher, or handler change must update this snapshot."""
    generated = hook.to_codex_hooks(_load_json(CLAUDE_SETTINGS))

    assert _topology(generated) == EXPECTED_TOPOLOGY


def test_generated_handlers_exist_and_use_the_codex_adapter():
    """Every shared Python/Bash handler is adapted, including the session bridge."""
    generated = hook.to_codex_hooks(_load_json(CLAUDE_SETTINGS))

    for event, groups in generated["hooks"].items():
        for group in groups:
            for entry in group["hooks"]:
                command = entry["command"]
                paths = _repo_paths(command)

                assert command.startswith(hook.CODEX_ADAPTER)
                assert f"--event {event} --" in command
                assert hook.CLAUDE_PROJECT_DIR_PREFIX not in command
                assert paths
                for relative_path in paths:
                    assert (REPO_ROOT / relative_path).is_file(), relative_path

    session_command = generated["hooks"]["SessionStart"][0]["hooks"][0]["command"]
    assert hook.CLAUDE_SESSION_START not in session_command
    assert "scripts/hooks/codex-session-start.py" in session_command
