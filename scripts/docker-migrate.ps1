# Runs Alembic migrations inside the app container.
# On failure: writes output to logs/docker/migrate.log.
# On success: clears the artifact.
#
# Uses `docker ps --filter` for status queries instead of `docker compose ps`
# to avoid Compose v2 hangs when containers are unhealthy.
$ErrorActionPreference = "Continue"

$project = Split-Path -Leaf (Get-Location)
$projectFilter = "label=com.docker.compose.project=$project"
$appServiceFilter = "label=com.docker.compose.service=app"

$artifact = "logs/docker/migrate.log"
if (-not (Test-Path "logs/docker")) { New-Item -ItemType Directory -Path "logs/docker" -Force | Out-Null }

Write-Host ""
Write-Host "=== Carameli DB Migrations ===" -ForegroundColor Cyan
Write-Host "Artifact : $((Resolve-Path $artifact -ErrorAction SilentlyContinue) ?? (Join-Path $PWD $artifact))" -ForegroundColor DarkGray
Write-Host "Command  : docker compose exec app alembic upgrade head" -ForegroundColor DarkGray
Write-Host ""

# Check app container is running
$status = docker ps --filter $projectFilter --filter $appServiceFilter --format "{{.Status}}" 2>&1
if ($status -notmatch "Up|running") {
    $msg = "service 'app' is not running (status: $status). Run the 'Start: Full Stack' task first."
    Write-Host "  [FAIL] $msg" -ForegroundColor Red
    @(
        "Failed task: DB: Apply Migrations"
        "Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        ""
        $msg
        ""
        "=== docker ps (project containers) ==="
    ) + (docker ps -a --filter $projectFilter --format "table {{.Names}}\t{{.Status}}" 2>&1) | Set-Content $artifact
    Write-Host ""
    Write-Host "Errors written to: $artifact" -ForegroundColor Red
    exit 1
}

Write-Host "Running alembic upgrade head..." -ForegroundColor Yellow
$output = docker compose exec app alembic upgrade head 2>&1
$exitCode = $LASTEXITCODE

$output | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
Write-Host ""

if ($exitCode -eq 0) {
    Set-Content $artifact ""
    Write-Host "  ==========================================" -ForegroundColor Green
    Write-Host "         MIGRATIONS APPLIED                  " -ForegroundColor Green
    Write-Host "  ==========================================" -ForegroundColor Green
    Write-Host ""
    exit 0
}

Write-Host "  [FAIL] alembic exited with code $exitCode" -ForegroundColor Red

@(
    "Failed task: DB: Apply Migrations"
    "Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    ""
    "=== alembic upgrade head ==="
) + $output | Set-Content $artifact

Write-Host ""
Write-Host "Errors written to: $artifact" -ForegroundColor Red
Write-Host ""
Write-Host "  ==========================================" -ForegroundColor Red
Write-Host "         MIGRATION FAILED                    " -ForegroundColor Red
Write-Host "  ==========================================" -ForegroundColor Red
Write-Host ""
exit $exitCode
