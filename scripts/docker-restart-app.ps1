# Restarts the app container without rebuilding.
# On failure: writes output to logs/docker/restart.log.
# On success: clears the artifact.
#
# Uses `docker ps --filter` for status queries instead of `docker compose ps`
# to avoid Compose v2 hangs when containers are unhealthy.
$ErrorActionPreference = "Continue"

$project = Split-Path -Leaf (Get-Location)
$projectFilter = "label=com.docker.compose.project=$project"
$appServiceFilter = "label=com.docker.compose.service=app"

# docker logs can hang on stuck containers; wrap with a 10-second timeout.
function Get-DockerLogs([string]$Container, [int]$Tail = 40, [int]$Timeout = 10) {
    $job = Start-Job -ScriptBlock {
        param($c, $t) docker logs $c --tail $t 2>&1
    } -ArgumentList $Container, $Tail
    $done = $job | Wait-Job -Timeout $Timeout
    if ($done) {
        $result = Receive-Job $job
        Remove-Job $job -Force
        return $result
    }
    Stop-Job $job; Remove-Job $job -Force
    return "[TIMEOUT] docker logs $Container --tail $Tail timed out after ${Timeout}s (container log stream may be stuck)"
}

$artifact = "logs/docker/restart.log"
if (-not (Test-Path "logs/docker")) { New-Item -ItemType Directory -Path "logs/docker" -Force | Out-Null }

Write-Host ""
Write-Host "=== Carameli Restart App ===" -ForegroundColor Cyan
Write-Host "Artifact : $((Resolve-Path $artifact -ErrorAction SilentlyContinue) ?? (Join-Path $PWD $artifact))" -ForegroundColor DarkGray
Write-Host "Command  : docker compose restart app" -ForegroundColor DarkGray
Write-Host ""

# Check app container exists
$status = docker ps --filter $projectFilter --filter $appServiceFilter --format "{{.Status}}" 2>&1
if ($status -notmatch "Up|running|Restarting") {
    $msg = "service 'app' is not running (status: $status). Run the 'Start: Full Stack' task first."
    Write-Host "  [FAIL] $msg" -ForegroundColor Red
    @(
        "Failed task: Restart: App Container"
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

Write-Host "Restarting app container..." -ForegroundColor Yellow
$output = docker compose restart app 2>&1
$exitCode = $LASTEXITCODE

$output | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
Write-Host ""

if ($exitCode -ne 0) {
    Write-Host "  [FAIL] docker compose restart app exited with code $exitCode" -ForegroundColor Red
    @(
        "Failed task: Restart: App Container"
        "Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        ""
        "=== docker compose restart app ==="
    ) + $output | Set-Content $artifact
    Write-Host ""
    Write-Host "Errors written to: $artifact" -ForegroundColor Red
    exit $exitCode
}

# Wait for health check
Write-Host "Waiting for app to become healthy..." -ForegroundColor Yellow
$maxWait = 30
$elapsed = 0

while ($elapsed -lt $maxWait) {
    Start-Sleep -Seconds 3
    $elapsed += 3
    $health = docker ps --filter $projectFilter --filter $appServiceFilter --format "{{.Status}}" 2>&1
    if ($health -match "healthy") {
        Write-Host "  Healthy (${elapsed}s)" -ForegroundColor Green
        break
    }
    Write-Host "  Waiting... (${elapsed}s)" -ForegroundColor DarkGray
}

$health = docker ps --filter $projectFilter --filter $appServiceFilter --format "{{.Status}}" 2>&1
if ($health -match "unhealthy|Exited|exited|Dead|dead") {
    Write-Host "  [FAIL] app is $health after restart" -ForegroundColor Red
    $errorLines = @(
        "Failed task: Restart: App Container"
        "Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
        ""
        "App status after restart: $health"
        ""
        "=== docker ps (project containers) ==="
    ) + (docker ps -a --filter $projectFilter --format "table {{.Names}}\t{{.Status}}" 2>&1) + @("", "=== logs: app (last 40 lines) ===") + (Get-DockerLogs "${project}-app-1" -Tail 40)
    $errorLines | Set-Content $artifact
    Write-Host ""
    Write-Host "Errors written to: $artifact" -ForegroundColor Red
    Write-Host ""
    Write-Host "  ==========================================" -ForegroundColor Red
    Write-Host "         RESTART FAILED                      " -ForegroundColor Red
    Write-Host "  ==========================================" -ForegroundColor Red
    Write-Host ""
    exit 1
}

Set-Content $artifact ""
Write-Host ""
Write-Host "  ==========================================" -ForegroundColor Green
Write-Host "         APP RESTARTED                       " -ForegroundColor Green
Write-Host "  ==========================================" -ForegroundColor Green
Write-Host ""
exit 0
