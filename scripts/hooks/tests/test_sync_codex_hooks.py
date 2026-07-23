"""Unit tests for the .codex/hooks.json generator (from .claude/settings.json)."""

import json

from conftest import load_module

hook = load_module("scripts/sync-codex-hooks.py")


class TestRewriteCommand:
    def test_strips_project_dir_prefix(self):
        assert (
            hook.rewrite_command('python3 "${CLAUDE_PROJECT_DIR:-.}/scripts/hooks/pretool.py"')
            == 'python3 "scripts/hooks/pretool.py"'
        )

    def test_keeps_claude_subpath_after_prefix(self):
        # The .claude/... portion is a real path Codex reads directly.
        assert (
            hook.rewrite_command(
                'python3 "${CLAUDE_PROJECT_DIR:-.}/.claude/skills/add-db-model/x.py"'
            )
            == 'python3 ".claude/skills/add-db-model/x.py"'
        )

    def test_command_without_prefix_is_unchanged(self):
        # Inline echo retros carry no project-dir path.
        cmd = "echo '{\"hookSpecificOutput\": {}}'"
        assert hook.rewrite_command(cmd) == cmd

    def test_rewrites_every_occurrence(self):
        cmd = "${CLAUDE_PROJECT_DIR:-.}/a && ${CLAUDE_PROJECT_DIR:-.}/b"
        assert hook.rewrite_command(cmd) == "a && b"


class TestToCodexHooks:
    def test_wraps_in_hooks_key(self):
        assert hook.to_codex_hooks({"hooks": {}}) == {"hooks": {}}

    def test_missing_hooks_yields_empty(self):
        assert hook.to_codex_hooks({"env": {"A": "1"}}) == {"hooks": {}}

    def test_carries_every_event_and_rewrites_commands(self):
        claude = {
            "hooks": {
                "SessionStart": [
                    {
                        "hooks": [
                            {"type": "command", "command": 'bash "${CLAUDE_PROJECT_DIR:-.}/x.sh"'}
                        ]
                    }
                ],
                "PreToolUse": [
                    {
                        "matcher": "Bash",
                        "hooks": [
                            {
                                "type": "command",
                                "command": 'python3 "${CLAUDE_PROJECT_DIR:-.}/p.py"',
                            }
                        ],
                    }
                ],
            }
        }
        result = hook.to_codex_hooks(claude)
        assert set(result["hooks"]) == {"SessionStart", "PreToolUse"}
        assert result["hooks"]["SessionStart"][0]["hooks"][0]["command"] == 'bash "x.sh"'
        # The matcher passes through untouched.
        assert result["hooks"]["PreToolUse"][0]["matcher"] == "Bash"
        assert result["hooks"]["PreToolUse"][0]["hooks"][0]["command"] == 'python3 "p.py"'

    def test_preserves_hook_entry_fields(self):
        claude = {"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "run"}]}]}}
        entry = hook.to_codex_hooks(claude)["hooks"]["Stop"][0]["hooks"][0]
        assert entry == {"type": "command", "command": "run"}

    def test_does_not_mutate_input(self):
        claude = {
            "hooks": {
                "Stop": [
                    {"hooks": [{"command": "${CLAUDE_PROJECT_DIR:-.}/s.py", "type": "command"}]}
                ]
            }
        }
        hook.to_codex_hooks(claude)
        assert claude["hooks"]["Stop"][0]["hooks"][0]["command"] == "${CLAUDE_PROJECT_DIR:-.}/s.py"


def test_sync_writes_hooks_only(tmp_path):
    src = tmp_path / "claude.json"
    dest = tmp_path / "hooks.json"
    src.write_text(
        json.dumps(
            {
                "env": {"X": "1"},
                "permissions": {"allow": ["Read(*)"]},
                "hooks": {
                    "PostToolUse": [
                        {
                            "matcher": "^Edit$",
                            "hooks": [
                                {
                                    "type": "command",
                                    "command": 'python3 "${CLAUDE_PROJECT_DIR:-.}/lint.py"',
                                }
                            ],
                        }
                    ]
                },
            }
        ),
        encoding="utf-8",
    )

    assert hook.sync(src, dest) == 0
    written = json.loads(dest.read_text(encoding="utf-8"))
    # Only the hooks block is carried over -- no env/permissions leak into Codex.
    assert set(written) == {"hooks"}
    assert written["hooks"]["PostToolUse"][0]["hooks"][0]["command"] == 'python3 "lint.py"'
    # Must emit LF (repo enforces eol=lf), never CRLF, regardless of OS.
    assert b"\r\n" not in dest.read_bytes()


def test_sync_missing_src_is_noop(tmp_path):
    src = tmp_path / "missing.json"
    dest = tmp_path / "hooks.json"
    assert hook.sync(src, dest) == 0
    assert not dest.exists()
