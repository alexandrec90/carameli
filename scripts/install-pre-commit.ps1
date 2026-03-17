# Runs `pre-commit install` then patches the generated hook to pipe errors
# to logs/pre-commit-errors.log. Safe to re-run at any time.
$ErrorActionPreference = "Stop"

$hookFile = ".git/hooks/pre-commit"

Write-Host ""
Write-Host "=== Install + Patch Pre-Commit Hook ===" -ForegroundColor Cyan
Write-Host ""

# Step 1: run pre-commit install
Write-Host "Running pre-commit install..." -ForegroundColor Yellow
pre-commit install
if ($LASTEXITCODE -ne 0) {
    Write-Host "pre-commit install failed." -ForegroundColor Red
    exit 1
}
Write-Host "  [pass] pre-commit install" -ForegroundColor Green

# Step 2: verify hook exists
if (-not (Test-Path $hookFile)) {
    Write-Host "Hook file not found at $hookFile" -ForegroundColor Red
    exit 1
}

# Step 3: patch — replace the exec calls with tee + artifact logic
$content = Get-Content $hookFile -Raw

# Already patched?
if ($content -match "ARTIFACT=") {
    Write-Host "  [skip] hook already patched" -ForegroundColor Green
    Write-Host ""
    exit 0
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
ARTIFACT="logs/pre-commit-errors.log"
mkdir -p logs

TMPOUT=$(mktemp)
trap 'rm -f "$TMPOUT"' EXIT

if [ -x "$INSTALL_PYTHON" ]; then
    "$INSTALL_PYTHON" -mpre_commit "${ARGS[@]}" 2>&1 | tee "$TMPOUT"
elif command -v pre-commit > /dev/null; then
    pre-commit "${ARGS[@]}" 2>&1 | tee "$TMPOUT"
else
    echo '`pre-commit` not found.  Did you forget to activate your virtualenv?' 1>&2
    exit 1
fi
EXIT_CODE=${PIPESTATUS[0]}

if [ $EXIT_CODE -ne 0 ]; then
    cp "$TMPOUT" "$ARTIFACT"
    echo "" >&2
    echo "Pre-commit errors written to: $ARTIFACT" >&2
else
    > "$ARTIFACT"
fi

exit $EXIT_CODE
'@

if ($content.Contains($oldTail)) {
    $patched = $content.Replace($oldTail, $newTail)
    Set-Content $hookFile $patched -NoNewline
    Write-Host "  [pass] hook patched (errors -> logs/pre-commit-errors.log)" -ForegroundColor Green
} else {
    Write-Host "  [WARN] hook structure not recognized -- manual patch may be needed" -ForegroundColor Yellow
    Write-Host "         Expected the standard pre-commit exec block but did not find it." -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "  ==========================================" -ForegroundColor Green
Write-Host "       PRE-COMMIT HOOK INSTALLED + PATCHED   " -ForegroundColor Green
Write-Host "  ==========================================" -ForegroundColor Green
Write-Host ""
exit 0
