# Fixes Docker Desktop when it stalls on startup or "Starting Docker Engine" hangs.
# More aggressive than docker-restart-engine.ps1: kills vmmem, force-terminates WSL
# with a timeout, resets cached state, and polls until the engine responds.
# On failure: writes output to logs/docker/fix.log.
# On success: clears the artifact.
$ErrorActionPreference = "Continue"

$artifact = "logs/docker/fix.log"
if (-not (Test-Path "logs/docker")) { New-Item -ItemType Directory -Path "logs/docker" -Force | Out-Null }

Write-Host ""
Write-Host "=== Docker Desktop Fix (aggressive) ===" -ForegroundColor Cyan
Write-Host "Artifact : $((Resolve-Path $artifact -ErrorAction SilentlyContinue) ?? (Join-Path $PWD $artifact))" -ForegroundColor DarkGray
Write-Host ""

$errorLines = [System.Collections.Generic.List[string]]::new()
$failed = $false

# --- Step 1: Kill ALL Docker processes ---
Write-Host "Step 1: Killing Docker processes..." -ForegroundColor Yellow
$procs = @("Docker Desktop", "com.docker.backend", "com.docker.service", "com.docker.proxy")
foreach ($proc in $procs) {
    $output = taskkill /f /im "$proc.exe" 2>&1
    # Suppress "not found" lines -- they are expected when the process is already gone
    $output | Where-Object { $_ -notmatch "not found" } |
              ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
}
Start-Sleep -Seconds 2
Write-Host "  Done." -ForegroundColor Green
Write-Host ""

# --- Step 2: wsl --shutdown with a timeout (the key fix) ---
Write-Host "Step 2: Shutting down WSL (15s timeout)..." -ForegroundColor Yellow
$job = Start-Job -ScriptBlock { wsl --shutdown 2>&1 }
$done = $job | Wait-Job -Timeout 15
if ($done) {
    $output = Receive-Job $job
    Remove-Job $job -Force
    $output | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    Write-Host "  WSL shutdown succeeded." -ForegroundColor Green
} else {
    Stop-Job $job; Remove-Job $job -Force
    Write-Host "  wsl --shutdown timed out -- force-killing vmmem..." -ForegroundColor DarkYellow

    # vmmem is the WSL2 Hyper-V VM process. Killing it is the only way out
    # when the VM is wedged and wsl --shutdown hangs.
    taskkill /f /im vmmem.exe 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
    Start-Sleep -Seconds 3

    # Verify vmmem is actually gone
    $still = Get-Process -Name vmmem -ErrorAction SilentlyContinue
    if ($still) {
        $failed = $true
        $errorLines.Add("=== vmmem still running after force kill ===")
        $errorLines.Add("PID: $($still.Id)")
        $errorLines.Add("")
        Write-Host "  [ERROR] vmmem still alive (PID $($still.Id)). Reboot may be required." -ForegroundColor Red
    } else {
        Write-Host "  vmmem killed. WSL VM terminated." -ForegroundColor Green
    }
}
Write-Host ""

# --- Step 3: Stop the Windows service (best-effort) ---
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if ($isAdmin) {
    Write-Host "Step 3: Stopping com.docker.service Windows service..." -ForegroundColor Yellow
    Stop-Service com.docker.service -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Write-Host "  Done." -ForegroundColor Green
} else {
    Write-Host "Step 3: [SKIP] Not Admin -- cannot stop Windows service" -ForegroundColor DarkYellow
}
Write-Host ""

# --- Step 4: Reset Docker Desktop cached state ---
Write-Host "Step 4: Clearing Docker Desktop cached state..." -ForegroundColor Yellow
$dirs = @(
    "$env:APPDATA\Docker",
    "$env:LOCALAPPDATA\Docker"
)
foreach ($dir in $dirs) {
    if (Test-Path $dir) {
        Remove-Item -Recurse -Force $dir -ErrorAction SilentlyContinue
        Write-Host "  Removed: $dir" -ForegroundColor DarkGray
    }
    else {
        Write-Host "  Not found (skip): $dir" -ForegroundColor DarkGray
    }
}
Write-Host "  Done." -ForegroundColor Green
Write-Host ""

# --- Step 5: Restart Windows service (if Admin) ---
if ($isAdmin) {
    Write-Host "Step 5: Starting com.docker.service..." -ForegroundColor Yellow
    Start-Service com.docker.service -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Write-Host "  Done." -ForegroundColor Green
    Write-Host ""
}

# --- Step 6: Relaunch Docker Desktop ---
Write-Host "Step 6: Launching Docker Desktop..." -ForegroundColor Yellow
$dockerPath = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
if (Test-Path $dockerPath) {
    Start-Process $dockerPath
    Write-Host "  Started." -ForegroundColor Green
}
else {
    $failed = $true
    $errorLines.Add("=== Docker Desktop not found ===")
    $errorLines.Add("Expected path: $dockerPath")
    $errorLines.Add("")
    Write-Host "  [ERROR] Docker Desktop not found at: $dockerPath" -ForegroundColor Red
}
Write-Host ""

# --- Step 7: Poll until engine responds ---
Write-Host "Step 7: Waiting for Docker engine (90s timeout)..." -ForegroundColor Yellow
$elapsed = 0
$pollTimeout = 90
$pollInterval = 5
$probeTimeout = 10
$ready = $false

while ($elapsed -lt $pollTimeout) {
    Start-Sleep -Seconds $pollInterval
    $elapsed += $pollInterval

    $job = Start-Job -ScriptBlock { docker info 2>&1 }
    $done = $job | Wait-Job -Timeout $probeTimeout
    if ($done) {
        $ok = if ($job.State -eq 'Completed') { 0 } else { 1 }
        Remove-Job $job -Force
        if ($ok -eq 0) {
            $ready = $true
            break
        }
        Write-Host "  Not ready yet... (${elapsed}s)" -ForegroundColor DarkGray
    } else {
        Stop-Job $job; Remove-Job $job -Force
        Write-Host "  docker info timed out... (${elapsed}s)" -ForegroundColor DarkGray
    }
}

Write-Host ""

if ($ready) {
    Set-Content $artifact ""
    Write-Host "  ==========================================" -ForegroundColor Green
    Write-Host "         DOCKER ENGINE READY                 " -ForegroundColor Green
    Write-Host "  ==========================================" -ForegroundColor Green
    Write-Host ""
    exit 0
}

if (-not $failed) {
    $failed = $true
    $errorLines.Add("=== Engine did not respond within ${pollTimeout}s ===")
    $errorLines.Add("")
}

$header = @(
    "Failed task: Docker: Fix Stalled Desktop"
    "Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    ""
)
($header + $errorLines) | Set-Content $artifact

Write-Host "  ==========================================" -ForegroundColor Red
Write-Host "         ENGINE STILL NOT RESPONDING         " -ForegroundColor Red
Write-Host "  ==========================================" -ForegroundColor Red
Write-Host ""
Write-Host "  Last resort: reboot the machine." -ForegroundColor Red
Write-Host ""
exit 1
