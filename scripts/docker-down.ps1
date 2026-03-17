# Stops and removes all Docker Compose containers.
# On failure: writes output to logs/docker/down.log.
# On success: clears the artifact.
$ErrorActionPreference = "Continue"

$artifact = "logs/docker/down.log"
if (-not (Test-Path "logs/docker")) { New-Item -ItemType Directory -Path "logs/docker" -Force | Out-Null }

Write-Host ""
Write-Host "=== Carameli Docker Stop ===" -ForegroundColor Cyan
Write-Host "Artifact : $((Resolve-Path $artifact -ErrorAction SilentlyContinue) ?? (Join-Path $PWD $artifact))" -ForegroundColor DarkGray
Write-Host "Command  : docker compose down" -ForegroundColor DarkGray
Write-Host ""

Write-Host "Stopping containers..." -ForegroundColor Yellow
$output = docker compose down 2>&1
$exitCode = $LASTEXITCODE

$output | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
Write-Host ""

if ($exitCode -eq 0) {
    Set-Content $artifact ""
    Write-Host "  ==========================================" -ForegroundColor Green
    Write-Host "           STACK STOPPED                     " -ForegroundColor Green
    Write-Host "  ==========================================" -ForegroundColor Green
    Write-Host ""
    exit 0
}

Write-Host "  [FAIL] docker compose down exited with code $exitCode" -ForegroundColor Red

@(
    "Failed task: Stop: Docker Stack"
    "Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    ""
    "=== docker compose down ==="
) + $output | Set-Content $artifact

Write-Host ""
Write-Host "Errors written to: $artifact" -ForegroundColor Red
Write-Host ""
Write-Host "  ==========================================" -ForegroundColor Red
Write-Host "           STOP FAILED                       " -ForegroundColor Red
Write-Host "  ==========================================" -ForegroundColor Red
Write-Host ""
exit $exitCode
