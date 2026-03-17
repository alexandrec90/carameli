# Runs Ruff lint + autofix in the current workspace and exits with Ruff's exit code.
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

Write-Host "Running Ruff (ruff check . --fix)..."
ruff check . --fix

$exitCode = $LASTEXITCODE
if ($null -eq $exitCode) {
    $exitCode = 0
}

exit $exitCode
