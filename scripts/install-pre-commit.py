#!/usr/bin/env python3
"""Runs `pre-commit install` then patches the generated git hooks to pipe errors
to logs/pre-commit-errors.log and activate the venv. Safe to re-run any time.

The pure `patch_hook_content` function is unit-tested in
`scripts/hooks/tests/test_install_pre_commit.py`.
"""

import subprocess
import sys
from pathlib import Path

from script_common import venv_exe

REPO_ROOT = Path(__file__).resolve().parents[1]
HOOK_FILES = [
    REPO_ROOT / ".git" / "hooks" / "pre-commit",
    REPO_ROOT / ".git" / "hooks" / "pre-push",
]

OLD_TAIL = """if [ -x "$INSTALL_PYTHON" ]; then
    exec "$INSTALL_PYTHON" -mpre_commit "${ARGS[@]}"
elif command -v pre-commit > /dev/null; then
    exec pre-commit "${ARGS[@]}"
else
    echo '`pre-commit` not found.  Did you forget to activate your virtualenv?' 1>&2
    exit 1
fi
"""

NEW_TAIL = """# Activate the venv so language:system hooks find tools like detect-secrets-hook
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
if [ -z "$VIRTUAL_ENV" ] && [ -d "$REPO_ROOT/.venv/Scripts" ]; then
    export VIRTUAL_ENV="$REPO_ROOT/.venv"
    export PATH="$VIRTUAL_ENV/Scripts:$PATH"
fi

ARTIFACT="logs/pre-commit-errors.log"
mkdir -p logs

TMPOUT=$(mktemp)
trap 'rm -f "$TMPOUT"' EXIT

run_pre_commit() {
    if [ -x "$INSTALL_PYTHON" ]; then
        "$INSTALL_PYTHON" -mpre_commit "$@"
    elif command -v pre-commit > /dev/null; then
        pre-commit "$@"
    else
        echo '`pre-commit` not found.  Did you forget to activate your virtualenv?' 1>&2
        return 1
    fi
}

# Snapshot mtimes of currently dirty files so we can detect hook-only changes
declare -A BEFORE_MTIME
while IFS= read -r f; do
    [ -f "$f" ] && BEFORE_MTIME["$f"]=$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f" 2>/dev/null)
done < <(git diff --name-only 2>/dev/null)

# --- First run ---
run_pre_commit "${ARGS[@]}" 2>&1 | tee "$TMPOUT"
EXIT_CODE=${PIPESTATUS[0]}

# --- Auto-fix retry: if hooks only modified files, stage them and re-run ---
if [ $EXIT_CODE -ne 0 ] && grep -q "files were modified by this hook" "$TMPOUT"; then
    HOOK_MODIFIED=()
    while IFS= read -r f; do
        [ -f "$f" ] || continue
        NOW_MTIME=$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f" 2>/dev/null)
        if [ -z "${BEFORE_MTIME[$f]+x}" ]; then
            HOOK_MODIFIED+=("$f")
        elif [ "$NOW_MTIME" != "${BEFORE_MTIME[$f]}" ]; then
            HOOK_MODIFIED+=("$f")
        fi
    done < <(git diff --name-only 2>/dev/null)

    if [ ${#HOOK_MODIFIED[@]} -gt 0 ]; then
        echo "" >&2
        echo "Auto-fixed files detected -- staging and retrying:" >&2
        for f in "${HOOK_MODIFIED[@]}"; do
            echo "  $f" >&2
            git add -- "$f"
        done

        TMPOUT2=$(mktemp)
        trap 'rm -f "$TMPOUT" "$TMPOUT2"' EXIT
        run_pre_commit "${ARGS[@]}" 2>&1 | tee "$TMPOUT2"
        EXIT_CODE=${PIPESTATUS[0]}
        cp "$TMPOUT2" "$TMPOUT"
    fi
fi

if [ $EXIT_CODE -ne 0 ]; then
    cp "$TMPOUT" "$ARTIFACT"
    echo "" >&2
    echo "Pre-commit errors written to: $ARTIFACT" >&2
else
    > "$ARTIFACT"
fi

exit $EXIT_CODE
"""


def patch_hook_content(content: str) -> tuple[str | None, str]:
    """Return (new_content, status). status is one of:
    'already' (no-op), 'patched' (replaced), 'unrecognized' (block not found)."""
    if "ARTIFACT=" in content and "Auto-fix retry" in content:
        return None, "already"
    content_lf = content.replace("\r\n", "\n")
    old_lf = OLD_TAIL.replace("\r\n", "\n")
    new_lf = NEW_TAIL.replace("\r\n", "\n")
    if old_lf in content_lf:
        return content_lf.replace(old_lf, new_lf), "patched"
    return None, "unrecognized"


def _install() -> int:
    return subprocess.run(
        [
            str(venv_exe("python")),
            "-m",
            "pre_commit",
            "install",
            "--hook-type",
            "pre-commit",
            "--hook-type",
            "pre-push",
        ],
        cwd=REPO_ROOT,
    ).returncode


def main() -> int:
    print("\n=== Install + Patch Pre-Commit Hook ===\n")
    print("Running pre-commit install (via venv Python)...")
    if _install() != 0:
        print("pre-commit install failed.", file=sys.stderr)
        return 1
    print("  [pass] pre-commit install")

    for hook_file in HOOK_FILES:
        if not hook_file.exists():
            print(f"Hook file not found at {hook_file}", file=sys.stderr)
            return 1
        content = hook_file.read_text(encoding="utf-8")

        # Old patch (artifact but no retry logic): regenerate a fresh hook first.
        if "ARTIFACT=" in content and "Auto-fix retry" not in content:
            print(f"  [info] upgrading {hook_file.name} patch (adding auto-fix retry)...")
            _install()
            content = hook_file.read_text(encoding="utf-8")

        new_content, status = patch_hook_content(content)
        if status == "already":
            print(f"  [skip] {hook_file.name} already patched (with retry)")
            continue
        if status == "patched":
            hook_file.write_text(new_content, encoding="utf-8", newline="")
            print(
                f"  [pass] {hook_file.name} patched "
                "(venv activation + errors -> logs/pre-commit-errors.log)"
            )
        else:
            print(
                f"  [WARN] {hook_file.name} structure not recognized -- manual patch may be needed",
                file=sys.stderr,
            )
            return 1

    print("\n  PRE-COMMIT HOOK INSTALLED + PATCHED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
