"""Repository-level contract tests for generated Codex hook wiring."""

import json
import re
from pathlib import Path

from conftest import load_module

hook = load_module("scripts/sync-codex-hooks.py")

REPO_ROOT = Path(__file__).resolve().parents[3]
CLAUDE_SETTINGS = REPO_ROOT / ".claude/settings.json"
CODEX_HOOKS = REPO_ROOT / ".codex/hooks.json"
ADAPTER = "scripts/hooks/codex-hook-adapter.py"
EXPECTED_DROPPED_EVENTS = frozenset({"PostToolUseFailure"})
EXPECTED_DROPPED_MATCHERS = frozenset({("PostToolUse", "^Skill$")})
EXPECTED_REDUNDANT_HANDLERS = frozenset({("PreToolUse", "scripts/hooks/enforce-capped-bash.py")})
# An event that survives classification but loses every handler is omitted entirely, so
# it leaves by a different door than `PostToolUseFailure` and is asserted separately.
# `PreToolUse` used to leave that way, when the Bash output cap -- redundant under Codex,
# which caps command output itself -- was its only handler. The worktree-guard launcher
# adopted with devkit v0.11.14 is a second, non-redundant `PreToolUse` handler, so the
# event now reaches Codex and nothing is emptied. Drop that handler and this grows again.
EXPECTED_EMPTIED_EVENTS: frozenset[str] = frozenset()
EXPECTED_TOPOLOGY = {
    "SessionStart": (
        (
            "",
            (
                ("scripts/hooks/codex-session-start.py",),
                ("scripts/prune-logs.py",),
            ),
        ),
    ),
    # No `UserPromptSubmit`. It ran `branch-per-task.py`, which devkit retired in
    # v0.7.0: cutting the task branch *inside* the checkout the session was in is what
    # let a checkout outlive its task. `worktree-guard.py` routes the same edit into an
    # ephemeral box instead, so there is no prompt-time handler left to mirror.
    # `PreToolUse` carries one group, not two: the Bash output cap is classified
    # redundant and dropped, leaving the worktree-guard launcher as the whole event.
    "PreToolUse": (
        (
            "^(Edit|Write|MultiEdit|NotebookEdit|apply_patch|create_file|Bash|PowerShell)$",
            (("scripts/hooks/worktree-guard-launch.py",),),
        ),
    ),
    "PostToolUse": (
        (
            "^(Edit|Write|MultiEdit|apply_patch|create_file)$",
            (("scripts/hooks/lint-fix.py",),),
        ),
    ),
    "Stop": (
        (
            "",
            (("scripts/hooks/stop.py",),),
        ),
    ),
}


def _load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _repo_paths(command: str) -> tuple[str, ...]:
    """Repo-relative paths the command names through the project-root placeholder.

    devkit v0.9.0 replaced the `$(git rev-parse --show-toplevel)` substitution with an
    inline Python launcher that discovers the root itself and expands
    `__CODEX_PROJECT_ROOT__` in its own arguments -- because command substitution is a
    POSIX-shell feature and Codex on Windows does not run one. The adapter's own path
    is inside that launcher rather than in a placeholder, so it is checked separately
    by `test_generated_handlers_exist_and_use_the_codex_adapter`.
    """
    return tuple(re.findall(rf"{re.escape(hook.CODEX_ROOT_EXPR)}/([^\"]+)", command))


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
    assert {(event, path) for event, path in hook.REDUNDANT_HANDLERS} == EXPECTED_REDUNDANT_HANDLERS
    assert dropped_events == EXPECTED_DROPPED_EVENTS | EXPECTED_EMPTIED_EVENTS
    assert source_matchers - generated_matchers == EXPECTED_DROPPED_MATCHERS | {
        ("PreToolUse", "Bash")
    }


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
                assert ADAPTER in command
                assert (REPO_ROOT / ADAPTER).is_file()
                assert f"--event {event} --" in command
                assert hook.CLAUDE_PROJECT_DIR_PREFIX not in command
                assert paths
                for relative_path in paths:
                    assert (REPO_ROOT / relative_path).is_file(), relative_path

    session_command = generated["hooks"]["SessionStart"][0]["hooks"][0]["command"]
    assert hook.CLAUDE_SESSION_START not in session_command
    assert "scripts/hooks/codex-session-start.py" in session_command
