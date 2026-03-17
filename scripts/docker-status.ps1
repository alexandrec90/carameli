# Comprehensive Docker stack diagnostic.
# Writes:
#   logs/docker/health.log    -- container status, sick-container logs, healthcheck details
#   logs/docker/config.log    -- compose config validation, Docker resource usage
#   logs/docker/app-logs.log  -- recent app container logs (always collected)
#
# Uses `docker ps --filter` for status queries instead of `docker compose ps`
# to avoid Compose v2 hangs when containers are unhealthy.
$ErrorActionPreference = "Continue"

$project = Split-Path -Leaf (Get-Location)
$projectFilter = "label=com.docker.compose.project=$project"

# Docker commands can hang when the daemon is unhealthy; wrap with a timeout.
function Invoke-DockerWithTimeout {
    param(
        [scriptblock]$ScriptBlock,
        [object[]]$ArgumentList = @(),
        [int]$Timeout = 15,
        [string]$Label = "docker command"
    )
    $job = Start-Job -ScriptBlock $ScriptBlock -ArgumentList $ArgumentList
    $done = $job | Wait-Job -Timeout $Timeout
    if ($done) {
        $result = Receive-Job $job
        Remove-Job $job -Force
        return @{ Output = $result; ExitCode = 0; TimedOut = $false }
    }
    Stop-Job $job; Remove-Job $job -Force
    return @{ Output = "[TIMEOUT] $Label timed out after ${Timeout}s"; ExitCode = 1; TimedOut = $true }
}

function Get-DockerLogs([string]$Container, [int]$Tail = 40, [int]$Timeout = 10) {
    $r = Invoke-DockerWithTimeout -Timeout $Timeout -Label "docker logs $Container" -ScriptBlock {
        param($c, $t) docker logs $c --tail $t 2>&1
    } -ArgumentList $Container, $Tail
    return $r.Output
}

$dockerDir = "logs/docker"
if (-not (Test-Path $dockerDir)) { New-Item -ItemType Directory -Path $dockerDir -Force | Out-Null }

$healthArtifact = "$dockerDir/health.log"
$configArtifact = "$dockerDir/config.log"
$appLogsArtifact = "$dockerDir/app-logs.log"

Write-Host ""
Write-Host "=== Docker Stack Diagnostic ===" -ForegroundColor Cyan
Write-Host "Health artifact   : $((Resolve-Path $healthArtifact -ErrorAction SilentlyContinue) ?? (Join-Path $PWD $healthArtifact))" -ForegroundColor DarkGray
Write-Host "Config artifact   : $((Resolve-Path $configArtifact -ErrorAction SilentlyContinue) ?? (Join-Path $PWD $configArtifact))" -ForegroundColor DarkGray
Write-Host "App logs artifact : $((Resolve-Path $appLogsArtifact -ErrorAction SilentlyContinue) ?? (Join-Path $PWD $appLogsArtifact))" -ForegroundColor DarkGray
Write-Host ""

$hasErrors = $false

# ============================================================
# CONFIG: Compose file validation + Docker resource usage
# ============================================================

$configLines = @(
    "Docker Config Diagnostic"
    "Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    ""
)

# --- Compose config validation ---
Write-Host "--- Compose Config Validation ---" -ForegroundColor Yellow
$cfgResult = Invoke-DockerWithTimeout -Timeout 15 -Label "docker compose config" -ScriptBlock {
    docker compose config --quiet 2>&1
}
$configCheck = $cfgResult.Output
$configExit = $cfgResult.ExitCode

if ($configExit -eq 0) {
    Write-Host "  Compose file valid." -ForegroundColor Green
    $configLines += "=== Compose Config ==="
    $configLines += "Valid."
    $configLines += ""
}
elseif ($cfgResult.TimedOut) {
    $hasErrors = $true
    Write-Host "  [WARN] Compose config check timed out (Docker daemon may be stuck)" -ForegroundColor Yellow
    $configLines += "=== Compose Config (TIMEOUT) ==="
    $configLines += $configCheck
    $configLines += ""
}
else {
    $hasErrors = $true
    Write-Host "  [FAIL] Compose config invalid:" -ForegroundColor Red
    $configCheck | ForEach-Object { Write-Host "  $_" -ForegroundColor Red }
    $configLines += "=== Compose Config (INVALID) ==="
    $configLines += $configCheck
    $configLines += ""
}
Write-Host ""

# --- Docker resource usage ---
Write-Host "--- Docker Resources ---" -ForegroundColor Yellow
$dfResult = Invoke-DockerWithTimeout -Timeout 15 -Label "docker system df" -ScriptBlock {
    docker system df 2>&1
}
$dfOutput = $dfResult.Output
$dfExit = $dfResult.ExitCode

if ($dfExit -eq 0) {
    $dfOutput | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    $configLines += "=== Docker Resources (docker system df) ==="
    $configLines += $dfOutput
    $configLines += ""
}
elseif ($dfResult.TimedOut) {
    Write-Host "  [WARN] docker system df timed out (Docker daemon may be stuck)" -ForegroundColor Yellow
    $configLines += "=== Docker Resources (TIMEOUT) ==="
    $configLines += $dfOutput
    $configLines += ""
}
else {
    Write-Host "  [WARN] docker system df failed" -ForegroundColor Yellow
    $configLines += "=== Docker Resources ==="
    $configLines += "docker system df failed (exit $dfExit)"
    $configLines += $dfOutput
    $configLines += ""
}
Write-Host ""

$configLines | Set-Content $configArtifact

# ============================================================
# HEALTH: Container status + sick container logs + healthchecks
# ============================================================

$healthLines = @(
    "Docker Health Diagnostic"
    "Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    ""
)

# --- Container status (docker ps --filter, not docker compose ps) ---
Write-Host "--- Container Status ---" -ForegroundColor Yellow
$rawResult = Invoke-DockerWithTimeout -Timeout 15 -Label "docker ps (table)" -ScriptBlock {
    param($f) docker ps -a --filter $f --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" 2>&1
} -ArgumentList $projectFilter
$raw = $rawResult.Output

$rawAllResult = Invoke-DockerWithTimeout -Timeout 15 -Label "docker ps (parse)" -ScriptBlock {
    param($f) docker ps -a --filter $f --format "{{.Names}}|{{.Status}}" 2>&1
} -ArgumentList $projectFilter
$rawAll = $rawAllResult.Output

if ($rawResult.ExitCode -ne 0) {
    $msg = if ($rawResult.TimedOut) { "docker ps timed out -- Docker daemon may be stuck" } else { "docker ps failed -- is Docker running?" }
    Write-Host "  [FAIL] $msg" -ForegroundColor Red
    $healthLines += $msg
    $healthLines | Set-Content $healthArtifact
    exit 1
}

$raw | ForEach-Object { Write-Host "  $_" }
Write-Host ""

$healthLines += "=== Container Status ==="
$healthLines += ""
$healthLines += $raw
$healthLines += ""

# --- Identify sick containers ---
$sick = @()
foreach ($entry in $rawAll) {
    if ($entry -match "^([^|]+)\|(.+)$") {
        $name = $Matches[1].Trim()
        $svc = $name -replace "^${project}-(.+)-\d+$", '$1'
        $st = $Matches[2].Trim()
        if ($st -match "unhealthy|Exited|exited|Restarting") {
            $sick += $svc
        }
    }
}

if ($sick.Count -eq 0) {
    $summary = "All containers healthy."
    Write-Host "  $summary" -ForegroundColor Green
    $healthLines += $summary
}
else {
    $hasErrors = $true
    $summary = "Unhealthy/exited services: $($sick -join ', ')"
    Write-Host "  $summary" -ForegroundColor Red
    Write-Host ""
    $healthLines += $summary
    $healthLines += ""

    foreach ($svc in $sick) {
        Write-Host "--- Logs: $svc (last 40 lines) ---" -ForegroundColor Yellow
        $svcLogs = Get-DockerLogs "${project}-${svc}-1" -Tail 40
        $svcLogs | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
        Write-Host ""

        $healthLines += "=== Logs: $svc (last 40 lines) ==="
        $healthLines += $svcLogs
        $healthLines += ""
    }

    # Healthcheck details via docker inspect
    Write-Host "--- Healthcheck Details ---" -ForegroundColor Yellow
    $healthLines += "=== Healthcheck Details ==="
    foreach ($svc in $sick) {
        $idResult = Invoke-DockerWithTimeout -Timeout 10 -Label "docker ps -q ($svc)" -ScriptBlock {
            param($f, $s) docker ps -q --filter $f --filter "label=com.docker.compose.service=$s" 2>&1
        } -ArgumentList $projectFilter, $svc
        $containerId = $idResult.Output
        if ($containerId -and -not $idResult.TimedOut) {
            $hcResult = Invoke-DockerWithTimeout -Timeout 10 -Label "docker inspect ($svc)" -ScriptBlock {
                param($id) docker inspect --format "{{json .State.Health}}" $id 2>&1
            } -ArgumentList $containerId
            $hcLog = $hcResult.Output
            Write-Host "  $svc : $hcLog" -ForegroundColor DarkGray
            $healthLines += "$svc : $hcLog"
        }
    }
    $healthLines += ""
}

$healthLines | Set-Content $healthArtifact

# ============================================================
# APP LOGS: Always collect recent app container output
# ============================================================

$appLogLines = @(
    "App container logs"
    "Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    ""
)

$appStatusResult = Invoke-DockerWithTimeout -Timeout 10 -Label "docker ps (app status)" -ScriptBlock {
    param($f) docker ps --filter $f --filter "label=com.docker.compose.service=app" --format "{{.Status}}" 2>&1
} -ArgumentList $projectFilter
$appStatus = $appStatusResult.Output
if ($appStatusResult.TimedOut -or $appStatus -notmatch "Up|running|Restarting|Exited|exited") {
    $appMsg = "service 'app' has no container."
    Write-Host "--- App Logs ---" -ForegroundColor Yellow
    Write-Host "  [SKIP] $appMsg" -ForegroundColor DarkGray
    $appLogLines += $appMsg
}
else {
    Write-Host "--- App Logs (last 100 lines) ---" -ForegroundColor Yellow
    $appLogs = Get-DockerLogs "${project}-app-1" -Tail 100
    $appLogs | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }

    $appLogLines += "App status: $appStatus"
    $appLogLines += ""
    $appLogLines += "=== docker logs ${project}-app-1 --tail 100 ==="
    $appLogLines += $appLogs
}
Write-Host ""

$appLogLines | Set-Content $appLogsArtifact

# ============================================================
# Summary
# ============================================================
Write-Host ""
if ($hasErrors) {
    Write-Host "  ==========================================" -ForegroundColor Red
    Write-Host "         ISSUES FOUND                        " -ForegroundColor Red
    Write-Host "  ==========================================" -ForegroundColor Red
}
else {
    Write-Host "  ==========================================" -ForegroundColor Green
    Write-Host "         ALL CLEAR                           " -ForegroundColor Green
    Write-Host "  ==========================================" -ForegroundColor Green
}
Write-Host ""
Write-Host "Reports written to:" -ForegroundColor Cyan
Write-Host "  $healthArtifact" -ForegroundColor Cyan
Write-Host "  $configArtifact" -ForegroundColor Cyan
Write-Host "  $appLogsArtifact" -ForegroundColor Cyan
Write-Host ""
exit 0
