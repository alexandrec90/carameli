#!/usr/bin/env python3
"""Runs pre-commit hooks on all files and writes only error output to
logs/pre-commit-errors.log for AI-agent consumption. On pass, clears it.

If every failing hook only auto-reformatted files, the changes are staged and the
failed hooks re-run before reporting. The pure parsing/classification/rendering
helpers are unit-tested in `scripts/hooks/tests/test_pre_commit_runner.py`.
"""

import os
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
ARTIFACT = REPO_ROOT / "logs" / "pre-commit-errors.log"
CONFIG = REPO_ROOT / ".pre-commit-config.yaml"

_RESULT_RE = re.compile(r"^(.+?)\.{3,}.*(Passed|Failed|Skipped)")
_MISCONFIG_RE = re.compile(
    r"unrecognized subcommand|unknown option|not found|command not found|No such file"
)


def parse_hook_blocks(lines: list[str]) -> dict[str, list[str]]:
    """Parse pre-commit output into {hook_name: body_lines} for Failed hooks only."""
    hooks: dict[str, list[str]] = {}
    current = None
    for line in lines:
        m = _RESULT_RE.match(line)
        if m:
            name, result = m.group(1).strip(), m.group(2)
            if result == "Failed":
                current = name
                hooks[current] = []
            else:
                current = None
            continue
        if current is not None and line.strip():
            hooks[current].append(line)
    return hooks


def classify_hook(body: list[str]) -> str:
    """Classify a failed hook: 'misconfigured', 'auto-fixed', or 'error'."""
    blob = "\n".join(body)
    if _MISCONFIG_RE.search(blob):
        return "misconfigured"
    if "files were modified by this hook" in blob:
        return "auto-fixed"
    return "error"


def build_name_to_id(config_text: str) -> dict[str, str]:
    """Map hook display name -> hook id from .pre-commit-config.yaml."""
    mapping: dict[str, str] = {}
    last_id = None
    for line in config_text.splitlines():
        id_match = re.match(r"^\s+-\s+id:\s+(\S+)", line)
        name_match = re.match(r"^\s+name:\s+(.+)$", line)
        if id_match:
            last_id = id_match.group(1).strip()
        elif name_match and last_id:
            mapping[name_match.group(1).strip()] = last_id
            last_id = None
    return mapping


def render_artifact(
    hooks: dict[str, list[str]], tags: dict[str, str], auto_fixed_files: list[str]
) -> str:
    """Render the structured per-hook artifact body."""
    out: list[str] = []
    for hook_id, body in hooks.items():
        tag = tags.get(hook_id, "error")
        out += [f"## {hook_id} [{tag}]", ""]
        if tag == "auto-fixed":
            out.append("Files were reformatted by the hook (already fixed on disk).")
            if auto_fixed_files:
                out.append("Modified files:")
                out += [f"  {f}" for f in auto_fixed_files]
            else:
                out += [f"  {bl}" for bl in body]
            out += ["", "Action: stage the modified files and re-commit."]
        elif tag == "misconfigured":
            out += [
                "The hook itself errored (not a source-code issue).",
                f"Fix target: .pre-commit-config.yaml (entry for `{hook_id}`)",
                "",
                "Hook output:",
            ]
            out += [f"  {bl}" for bl in body]
        else:
            out += body
        out.append("")
    return "\n".join(out) + "\n" if out else ""


def _activate_venv() -> None:
    venv = REPO_ROOT / ".venv"
    if not os.environ.get("VIRTUAL_ENV") and (venv / "Scripts").exists():
        os.environ["VIRTUAL_ENV"] = str(venv)
        os.environ["PATH"] = f"{venv / 'Scripts'}{os.pathsep}{os.environ['PATH']}"


def _git_dirty_files() -> list[str]:
    p = subprocess.run(
        ["git", "diff", "--name-only"],
        cwd=REPO_ROOT,
        stdout=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return [f for f in (p.stdout or "").splitlines() if f.strip()]


def _mtimes(files: list[str]) -> dict[str, float]:
    out = {}
    for f in files:
        path = REPO_ROOT / f
        if path.exists():
            out[f] = path.stat().st_mtime
    return out


def _changed_since(before: dict[str, float]) -> list[str]:
    """Files newly dirty or with a changed mtime since the `before` snapshot."""
    changed = []
    for f in _git_dirty_files():
        path = REPO_ROOT / f
        if not path.exists():
            continue
        mtime = path.stat().st_mtime
        if f not in before or mtime != before[f]:
            changed.append(f)
    return changed


def _run_pre_commit(extra_args=None) -> tuple[list[str], int]:
    cmd = (
        ["pre-commit", "run", "--all-files"]
        if not extra_args
        else ["pre-commit", "run", *extra_args, "--all-files"]
    )
    p = subprocess.run(
        cmd,
        cwd=REPO_ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return (p.stdout or "").splitlines(), p.returncode


def _pass(message: str) -> int:
    ARTIFACT.write_text("", encoding="utf-8")
    print(f"\n  [pass] {message}")
    print("  PRE-COMMIT PASSED")
    return 0


def main() -> int:
    _activate_venv()
    ARTIFACT.parent.mkdir(parents=True, exist_ok=True)

    print("\n=== Carameli Pre-Commit Hooks ===")
    print(f"Artifact : {ARTIFACT}\n")
    print("Running pre-commit on all files...\n")

    before = _mtimes(_git_dirty_files())
    lines, code = _run_pre_commit()
    for line in lines:
        print(f"  {line}")

    if code == 0:
        return _pass("pre-commit")

    hooks = parse_hook_blocks(lines)
    if not hooks:
        ARTIFACT.write_text("\n".join(lines) + "\n", encoding="utf-8")
        print(f"\nErrors written to: {ARTIFACT}\n  PRE-COMMIT FAILED")
        return code

    auto_fixed_files = _changed_since(before)
    tags = {hook_id: classify_hook(body) for hook_id, body in hooks.items()}

    # If every failure is an auto-fix, stage real changes and re-run the failed hooks.
    if all(tag == "auto-fixed" for tag in tags.values()):
        if not auto_fixed_files:
            return _pass("pre-commit (no actual file changes from auto-fix hooks)")
        name_to_id = build_name_to_id(CONFIG.read_text(encoding="utf-8")) if CONFIG.exists() else {}
        print(f"  Auto-fixed files detected -- staging and re-running: {', '.join(hooks)}...")
        for f in auto_fixed_files:
            subprocess.run(
                ["git", "add", "--", f],
                cwd=REPO_ROOT,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        retry_lines: list[str] = []
        retry_ok = True
        for name in hooks:
            run_id = name_to_id.get(name, name)
            rlines, rcode = _run_pre_commit([run_id])
            retry_lines += rlines
            if rcode != 0:
                retry_ok = False
        if retry_ok:
            return _pass("pre-commit -- auto-fixed and re-staged")
        # Retry still failed: re-parse so the artifact reflects real errors.
        hooks = parse_hook_blocks(retry_lines)
        tags = {hook_id: "error" for hook_id in hooks}
        auto_fixed_files = []

    ARTIFACT.write_text(render_artifact(hooks, tags, auto_fixed_files), encoding="utf-8")
    print(f"\nErrors written to: {ARTIFACT}\n  PRE-COMMIT FAILED")
    return code


if __name__ == "__main__":
    sys.exit(main())
