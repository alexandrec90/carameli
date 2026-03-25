# Restarts Docker Desktop when the engine is stuck on "Starting the Docker Engine".
# Steps: kill processes -> wsl --shutdown -> restart service -> relaunch -> poll until ready.
#
# Requires: elevated (Admin) PowerShell for Stop-Service / Start-Service.
# If not elevated, the script will warn and attempt process-kill + relaunch only.

$ErrorActionPreference = "Continue"

$dockerDesktopExe = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
$pollTimeout = 90   # seconds to wait for the engine to respond
$pollInterval = 5

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

Write-Host ""
Write-Host "=== Docker Engine Restart ===" -ForegroundColor Cyan
Write-Host ""

# --- Step 1: Kill Docker processes ---
Write-Host "Stopping Docker Desktop..." -ForegroundColor Yellow
Stop-Process -Name "Docker Desktop" -Force -ErrorAction SilentlyContinue
Stop-Process -Name "com.docker.backend" -Force -ErrorAction SilentlyContinue
Stop-Process -Name "com.docker.service" -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 2

# --- Step 2: Stop the Windows service (needs Admin) ---
if ($isAdmin) {
    Write-Host "Stopping com.docker.service Windows service..." -ForegroundColor Yellow
    Stop-Service com.docker.service -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}
else {
    Write-Host "  [WARN] Not running as Admin -- skipping service stop (process kill only)" -ForegroundColor DarkYellow
}

# --- Step 3: Shut down WSL (most common fix for stuck engine) ---
Write-Host "Shutting down WSL..." -ForegroundColor Yellow
wsl --shutdown 2>&1 | Out-Null
Start-Sleep -Seconds 2

# --- Step 4: Restart the Windows service (needs Admin) ---
if ($isAdmin) {
    Write-Host "Starting com.docker.service Windows service..." -ForegroundColor Yellow
    Start-Service com.docker.service -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

# --- Step 5: Relaunch Docker Desktop ---
if (Test-Path $dockerDesktopExe) {
    Write-Host "Launching Docker Desktop..." -ForegroundColor Yellow
    Start-Process $dockerDesktopExe
}
else {
    Write-Host "  [ERROR] Docker Desktop not found at $dockerDesktopExe" -ForegroundColor Red
    Write-Host "  Set `$dockerDesktopExe at the top of this script if installed elsewhere." -ForegroundColor Red
    exit 1
}

# --- Step 6: Poll until the engine responds ---
Write-Host ""
Write-Host "Waiting for Docker engine (timeout ${pollTimeout}s)..." -ForegroundColor Yellow

$elapsed = 0
$probeTimeout = 10  # seconds per docker info attempt

while ($elapsed -lt $pollTimeout) {
    Start-Sleep -Seconds $pollInterval
    $elapsed += $pollInterval

    $job = Start-Job -ScriptBlock { docker info 2>&1 }
    $done = $job | Wait-Job -Timeout $probeTimeout
    if ($done) {
        $null = Receive-Job $job
        $ok = $job.ChildJobs[0].JobStateInfo.Reason.ExitCode
        if ($null -eq $ok) { $ok = if ($job.State -eq 'Completed') { 0 } else { 1 } }
        Remove-Job $job -Force
        if ($ok -eq 0) {
            Write-Host ""
            Write-Host "  ==========================================" -ForegroundColor Green
            Write-Host "           DOCKER ENGINE READY               " -ForegroundColor Green
            Write-Host "  ==========================================" -ForegroundColor Green
            Write-Host ""
            exit 0
        }
        Write-Host "  Not ready yet... (${elapsed}s)" -ForegroundColor DarkGray
    }
    else {
        Stop-Job $job; Remove-Job $job -Force
        Write-Host "  docker info timed out... (${elapsed}s)" -ForegroundColor DarkGray
    }
}

Write-Host ""
Write-Host "  ==========================================" -ForegroundColor Red
Write-Host "           ENGINE STILL NOT RESPONDING       " -ForegroundColor Red
Write-Host "  ==========================================" -ForegroundColor Red
Write-Host ""
Write-Host "  Docker did not respond within ${pollTimeout}s." -ForegroundColor Red
Write-Host "  Try:" -ForegroundColor Red
Write-Host "    1. Check Docker Desktop UI for error messages" -ForegroundColor Red
Write-Host "    2. Run this task again from an Admin terminal" -ForegroundColor Red
Write-Host "    3. Reboot the machine" -ForegroundColor Red
Write-Host ""
exit 1
