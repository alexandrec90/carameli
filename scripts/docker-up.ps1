# Builds and starts the full Docker Compose stack.
# On failure: writes unhealthy service logs to logs/docker/build.log.
# On success: clears the artifact.
#
# Uses `docker ps --filter` for health polling instead of `docker compose ps`
# to avoid Compose v2 hangs when containers are unhealthy.
#
# Flags:
#   -Build   Force a rebuild (use after changing requirements*.txt or Dockerfile)
param(
    [switch]$Build
)
$ErrorActionPreference = "Continue"

$project = Split-Path -Leaf (Get-Location)
$projectFilter = "label=com.docker.compose.project=$project"

# Run a docker command with a timeout; returns $null on timeout.
function Invoke-DockerWithTimeout([string[]]$DockerArgs, [int]$Timeout = 15) {
    $job = Start-Job -ScriptBlock {
        param($a) & docker @a 2>&1
    } -ArgumentList (,$DockerArgs)
    $done = $job | Wait-Job -Timeout $Timeout
    if ($done) {
        $result = Receive-Job $job
        Remove-Job $job -Force
        return $result
    }
    Stop-Job $job; Remove-Job $job -Force
    return $null
}

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

$artifact = "logs/docker/build.log"
if (-not (Test-Path "logs/docker")) { New-Item -ItemType Directory -Path "logs/docker" -Force | Out-Null }

Write-Host ""
Write-Host "=== Carameli Docker Stack ===" -ForegroundColor Cyan
Write-Host "Artifact : $((Resolve-Path $artifact -ErrorAction SilentlyContinue) ?? (Join-Path $PWD $artifact))" -ForegroundColor DarkGray
Write-Host ""

# --- Step 1: Pull pre-built registry images (skip buildable images like carameli-app) ---
# --ignore-buildable avoids a spurious "pull access denied for carameli-app" error because
# carameli-app is built locally from the Dockerfile, not pulled from a registry.
$pullTimeout = 600  # 10 minutes -- pulling all images cold can take a long time
Write-Host "Pulling registry images (timeout ${pullTimeout}s -- first run may be slow)..." -ForegroundColor Yellow

$pullJob = Start-Job -ScriptBlock { docker compose pull --ignore-buildable 2>&1 }
$pullDone = $pullJob | Wait-Job -Timeout $pullTimeout

if (-not $pullDone) {
    Stop-Job $pullJob; Remove-Job $pullJob -Force
    $msg = "[TIMEOUT] docker compose pull timed out after ${pullTimeout}s -- Docker daemon may be stuck or network is very slow. Try restarting Docker Desktop."
    Write-Host "  $msg" -ForegroundColor Red
    "Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')", "", $msg | Set-Content $artifact
    exit 1
}

$pullOutput = Receive-Job $pullJob
$pullExit = $pullJob.ChildJobs[0].JobStateInfo.Reason.ExitCode
if ($null -eq $pullExit) { $pullExit = if ($pullJob.State -eq 'Completed') { 0 } else { 1 } }
Remove-Job $pullJob -Force
$pullOutput | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
Write-Host ""

# --- Step 2: Build local app image (only when -Build is passed) ---
if ($Build) {
    $buildTimeout = 600  # 10 minutes -- pip install + layer caching on first run
    Write-Host "Building app image (timeout ${buildTimeout}s)..." -ForegroundColor Yellow

    $buildJob = Start-Job -ScriptBlock { docker compose build 2>&1 }
    $buildDone = $buildJob | Wait-Job -Timeout $buildTimeout

    if (-not $buildDone) {
        Stop-Job $buildJob; Remove-Job $buildJob -Force
        $msg = "[TIMEOUT] docker compose build timed out after ${buildTimeout}s -- Docker daemon may be stuck. Try restarting Docker Desktop."
        Write-Host "  $msg" -ForegroundColor Red
        "Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')", "", $msg | Set-Content $artifact
        exit 1
    }

    $buildOutput = Receive-Job $buildJob
    $buildExit = $buildJob.ChildJobs[0].JobStateInfo.Reason.ExitCode
    if ($null -eq $buildExit) { $buildExit = if ($buildJob.State -eq 'Completed') { 0 } else { 1 } }
    Remove-Job $buildJob -Force
    $buildOutput | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    Write-Host ""

    if ($buildExit -ne 0) {
        Write-Host "  [FAIL] docker compose build exited with code $buildExit" -ForegroundColor Red
        "Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')", "", ($buildOutput -join "`n") | Set-Content $artifact
        Write-Host ""
        Write-Host "Errors written to: $artifact" -ForegroundColor Red
        exit $buildExit
    }
}

# --- Step 3: Start services (images are cached; up -d should return quickly) ---
$upTimeout = 120  # seconds -- docker compose up -d should return quickly once images are cached
Write-Host "Starting services (timeout ${upTimeout}s)..." -ForegroundColor Yellow

$upJob = Start-Job -ScriptBlock { docker compose up -d 2>&1 }

$upDone = $upJob | Wait-Job -Timeout $upTimeout

if (-not $upDone) {
    Stop-Job $upJob; Remove-Job $upJob -Force
    $msg = "[TIMEOUT] docker compose up -d timed out after ${upTimeout}s -- Docker daemon may be stuck. Try restarting Docker Desktop."
    Write-Host "  $msg" -ForegroundColor Red
    "Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')", "", $msg | Set-Content $artifact
    exit 1
}

$output = Receive-Job $upJob
$exitCode = $upJob.ChildJobs[0].JobStateInfo.Reason.ExitCode
if ($null -eq $exitCode) { $exitCode = if ($upJob.State -eq 'Completed') { 0 } else { 1 } }
Remove-Job $upJob -Force

$output | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
Write-Host ""

if ($exitCode -ne 0) {
    Write-Host "  [FAIL] docker compose up exited with code $exitCode" -ForegroundColor Red
    "Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')", "", ($output -join "`n") | Set-Content $artifact
    Write-Host ""
    Write-Host "Errors written to: $artifact" -ForegroundColor Red
    exit $exitCode
}

# --- Wait for health checks (docker ps --filter, not docker compose ps) ---
Write-Host "Waiting for services to become healthy..." -ForegroundColor Yellow

$maxWait = 90
$elapsed = 0
$interval = 5

while ($elapsed -lt $maxWait) {
    Start-Sleep -Seconds $interval
    $elapsed += $interval

    $entries = Invoke-DockerWithTimeout -DockerArgs @("ps", "-a", "--filter", $projectFilter, "--format", "{{.Names}}|{{.Status}}")
    if ($null -eq $entries) {
        Write-Host "  [TIMEOUT] docker ps timed out -- Docker daemon may be stuck" -ForegroundColor Red
        "Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')", "", "[TIMEOUT] docker ps timed out during health poll -- Docker daemon may be stuck. Try restarting Docker Desktop." | Set-Content $artifact
        exit 1
    }

    $unhealthy = @()
    $starting = $false

    foreach ($entry in $entries) {
        if ($entry -match "^([^|]+)\|(.+)$") {
            $name = $Matches[1].Trim()
            $svc = $name -replace "^${project}-(.+)-\d+$", '$1'
            $st = $Matches[2].Trim()
            if ($st -match "unhealthy|Exited|exited|Dead|dead") {
                $unhealthy += $svc
            }
            elseif ($st -match "starting|Created|created") {
                $starting = $true
            }
        }
    }

    if ($unhealthy.Count -gt 0) {
        Write-Host "  Unhealthy: $($unhealthy -join ', ') (${elapsed}s)" -ForegroundColor Red
    }
    elseif ($starting) {
        Write-Host "  Still starting... (${elapsed}s)" -ForegroundColor DarkGray
    }
    else {
        Write-Host "  All services healthy (${elapsed}s)" -ForegroundColor Green
        break
    }
}

# --- Final status check ---
$entries = Invoke-DockerWithTimeout -DockerArgs @("ps", "-a", "--filter", $projectFilter, "--format", "{{.Names}}|{{.Status}}")
if ($null -eq $entries) {
    Write-Host "  [TIMEOUT] docker ps timed out -- Docker daemon may be stuck" -ForegroundColor Red
    "Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')", "", "[TIMEOUT] docker ps timed out during final check -- Docker daemon may be stuck. Try restarting Docker Desktop." | Set-Content $artifact
    exit 1
}

$failures = @()
foreach ($entry in $entries) {
    if ($entry -match "^([^|]+)\|(.+)$") {
        $name = $Matches[1].Trim()
        $svc = $name -replace "^${project}-(.+)-\d+$", '$1'
        $st = $Matches[2].Trim()
        if ($st -match "unhealthy|Exited|exited|Dead|dead|Created|created") {
            $failures += $svc
        }
    }
}

if ($failures.Count -eq 0) {
    Set-Content $artifact ""
    Write-Host ""
    Write-Host "  ==========================================" -ForegroundColor Green
    Write-Host "           STACK RUNNING                     " -ForegroundColor Green
    Write-Host "  ==========================================" -ForegroundColor Green
    Write-Host ""
    exit 0
}

# --- Collect logs from failed services ---
Write-Host ""
Write-Host "  [FAIL] Services not running: $($failures -join ', ')" -ForegroundColor Red

$errorLines = [System.Collections.Generic.List[string]]::new()
$errorLines.Add("Failed services: $($failures -join ', ')")
$errorLines.Add("Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
$errorLines.Add("")

# Include container status
$errorLines.Add("=== docker ps (project containers) ===")
$psTable = Invoke-DockerWithTimeout -DockerArgs @("ps", "-a", "--filter", $projectFilter, "--format", "table {{.Names}}\t{{.Status}}\t{{.Ports}}")
if ($null -eq $psTable) { $errorLines.Add("[TIMEOUT] docker ps timed out") }
else { $psTable | ForEach-Object { $errorLines.Add("$_") } }
$errorLines.Add("")

foreach ($svc in $failures) {
    $errorLines.Add("=== logs: $svc (last 40 lines) ===")
    Get-DockerLogs "${project}-${svc}-1" -Tail 40 | ForEach-Object { $errorLines.Add("$_") }
    $errorLines.Add("")
}

$errorLines | Set-Content $artifact

Write-Host ""
Write-Host "Errors written to: $artifact" -ForegroundColor Red
Write-Host ""
Write-Host "  ==========================================" -ForegroundColor Red
Write-Host "           STACK FAILED                      " -ForegroundColor Red
Write-Host "  ==========================================" -ForegroundColor Red
Write-Host ""
exit 1
