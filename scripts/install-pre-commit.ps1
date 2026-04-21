# Runs `pre-commit install` then patches the generated hooks to pipe errors
# to logs/pre-commit-errors.log and activate the venv. Safe to re-run at any time.
$ErrorActionPreference = "Stop"

$hookFiles = @(".git/hooks/pre-commit", ".git/hooks/pre-push")

Write-Host ""
Write-Host "=== Install + Patch Pre-Commit Hook ===" -ForegroundColor Cyan
Write-Host ""

# Step 1: run pre-commit install using the venv Python so INSTALL_PYTHON is
# set to the venv interpreter, ensuring language:system hooks resolve tools
# from the venv rather than from the system Python on PATH.
Write-Host "Running pre-commit install (via venv Python)..." -ForegroundColor Yellow
.venv\Scripts\python.exe -m pre_commit install --hook-type pre-commit --hook-type pre-push
if ($LASTEXITCODE -ne 0) {
    Write-Host "pre-commit install failed." -ForegroundColor Red
    exit 1
}
Write-Host "  [pass] pre-commit install" -ForegroundColor Green

# Step 2 & 3: verify and patch each hook
foreach ($hookFile in $hookFiles) {
if (-not (Test-Path $hookFile)) {
    Write-Host "Hook file not found at $hookFile" -ForegroundColor Red
    exit 1
}

# Step 3: patch — replace the exec calls with tee + artifact logic
$content = Get-Content $hookFile -Raw

# Already patched with retry logic?
if ($content -match "ARTIFACT=" -and $content -match "Auto-fix retry") {
    Write-Host "  [skip] $hookFile already patched (with retry)" -ForegroundColor Green
    continue
}

# Has old patch (artifact but no retry)? Strip it back to the generated template
# so the replacement below can match the standard exec block.
if ($content -match "ARTIFACT=" -and $content -notmatch "Auto-fix retry") {
    Write-Host "  [info] upgrading $hookFile patch (adding auto-fix retry)..." -ForegroundColor Yellow
    # Re-run pre-commit install to get a fresh hook, then re-read
    .venv\Scripts\python.exe -m pre_commit install --hook-type pre-commit --hook-type pre-push | Out-Null
    $content = Get-Content $hookFile -Raw
}

# The generated hook ends with an if/elif/else block using `exec`.
# Replace that block with our tee-to-artifact version.
$oldTail = @'
if [ -x "$INSTALL_PYTHON" ]; then
    exec "$INSTALL_PYTHON" -mpre_commit "${ARGS[@]}"
elif command -v pre-commit > /dev/null; then
    exec pre-commit "${ARGS[@]}"
else
    echo '`pre-commit` not found.  Did you forget to activate your virtualenv?' 1>&2
    exit 1
fi
'@

$newTail = @'
# Activate the venv so language:system hooks find tools like detect-secrets-hook
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
'@

# Normalize line endings for comparison (hook file is LF, here-strings are CRLF)
$contentLF = $content.Replace("`r`n", "`n")
$oldTailLF = $oldTail.Replace("`r`n", "`n")
$newTailLF = $newTail.Replace("`r`n", "`n")

if ($contentLF.Contains($oldTailLF)) {
    $patched = $contentLF.Replace($oldTailLF, $newTailLF)
    Set-Content $hookFile $patched -NoNewline -Encoding utf8NoBOM
    Write-Host "  [pass] $hookFile patched (venv activation + errors -> logs/pre-commit-errors.log)" -ForegroundColor Green
}
else {
    Write-Host "  [WARN] $hookFile structure not recognized -- manual patch may be needed" -ForegroundColor Yellow
    Write-Host "         Expected the standard pre-commit exec block but did not find it." -ForegroundColor Yellow
    exit 1
}
} # end foreach

Write-Host ""
Write-Host "  ==========================================" -ForegroundColor Green
Write-Host "       PRE-COMMIT HOOK INSTALLED + PATCHED   " -ForegroundColor Green
Write-Host "  ==========================================" -ForegroundColor Green
Write-Host ""
exit 0
