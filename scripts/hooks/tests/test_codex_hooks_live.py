"""Opt-in end-to-end smoke test for generated hooks in the real Codex CLI."""

import json
import shutil
import subprocess
import textwrap
from pathlib import Path

import pytest
from conftest import load_module

hook = load_module("scripts/sync-codex-hooks.py")
REPO_ROOT = Path(__file__).resolve().parents[3]

pytestmark = [
    pytest.mark.codex_live,
    pytest.mark.paid,
]


def _inline_hook_overrides(generated: dict) -> list[str]:
    """Encode generated lifecycle groups as session-local TOML config overrides."""
    args: list[str] = []
    for event, groups in generated["hooks"].items():
        encoded_groups = []
        for group in groups:
            fields = []
            if "matcher" in group:
                fields.append(f"matcher={json.dumps(group['matcher'])}")
            handlers = ",".join(
                (f"{{type={json.dumps(entry['type'])},command={json.dumps(entry['command'])}}}")
                for entry in group["hooks"]
            )
            fields.append(f"hooks=[{handlers}]")
            encoded_groups.append("{" + ",".join(fields) + "}")
        args.extend(["--config", f"hooks.{event}=[{','.join(encoded_groups)}]"])
    return args


def test_generated_lifecycle_hooks_run_in_isolated_codex_exec(tmp_path):
    """Exercise generation, adapter execution, and lifecycle delivery together."""
    codex = shutil.which("codex")
    if codex is None:
        pytest.skip("codex CLI is not installed")

    subprocess.run(
        ["git", "init", "--quiet"],
        cwd=tmp_path,
        check=True,
        capture_output=True,
        text=True,
    )
    scripts_dir = tmp_path / "scripts/hooks"
    scripts_dir.mkdir(parents=True)
    shutil.copyfile(
        REPO_ROOT / "scripts/hooks/codex-hook-adapter.py",
        scripts_dir / "codex-hook-adapter.py",
    )
    (tmp_path / "hook-recorder.py").write_text(
        textwrap.dedent(
            """\
            import json
            import sys
            from pathlib import Path

            payload = json.load(sys.stdin)
            event = payload.get("hook_event_name") or payload.get("hookEventName")
            with (Path(__file__).parent / "hook-events.jsonl").open(
                "a", encoding="utf-8", newline=""
            ) as stream:
                stream.write(json.dumps({"event": event}) + "\\n")
            """
        ),
        encoding="utf-8",
        newline="",
    )
    claude_settings = {
        "hooks": {
            event: [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": ('python3 "${CLAUDE_PROJECT_DIR:-.}/hook-recorder.py"'),
                        }
                    ]
                }
            ]
            for event in ("SessionStart", "UserPromptSubmit", "Stop")
        }
    }
    generated = hook.to_codex_hooks(claude_settings)

    result = subprocess.run(
        [
            codex,
            "exec",
            "--dangerously-bypass-hook-trust",
            "--enable",
            "hooks",
            "--ephemeral",
            "--ignore-user-config",
            "--ignore-rules",
            *_inline_hook_overrides(generated),
            "--sandbox",
            "read-only",
            "--color",
            "never",
            "Reply with exactly CODEX_HOOK_SMOKE_OK. Do not call tools.",
        ],
        cwd=tmp_path,
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        timeout=240,
        check=False,
    )
    diagnostic = f"stdout:\n{result.stdout}\n\nstderr:\n{result.stderr}"

    assert result.returncode == 0, diagnostic
    assert "CODEX_HOOK_SMOKE_OK" in result.stdout, diagnostic
    events_path = tmp_path / "hook-events.jsonl"
    assert events_path.is_file(), diagnostic
    events = {
        json.loads(line)["event"] for line in events_path.read_text(encoding="utf-8").splitlines()
    }
    assert {"SessionStart", "UserPromptSubmit", "Stop"} <= events
