# Tears down containers, prunes Docker, and compacts the WSL VHDX.
# On failure: writes output to logs/docker/prune.log.
# On success: clears the artifact.
$ErrorActionPreference = "Continue"

$artifact = "logs/docker/prune.log"
if (-not (Test-Path "logs/docker")) { New-Item -ItemType Directory -Path "logs/docker" -Force | Out-Null }

Write-Host ""
Write-Host "=== Docker Prune + Compact ===" -ForegroundColor Cyan
Write-Host "Artifact : $((Resolve-Path $artifact -ErrorAction SilentlyContinue) ?? (Join-Path $PWD $artifact))" -ForegroundColor DarkGray
Write-Host ""

$errorLines = [System.Collections.Generic.List[string]]::new()
$failed = $false

# --- Step 1: docker compose down ---
Write-Host "Stopping containers..." -ForegroundColor Yellow
$output = docker compose down 2>&1
$code = $LASTEXITCODE
$output | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }

if ($code -ne 0) {
    $failed = $true
    $errorLines.Add("=== docker compose down (exit $code) ===")
    $output | ForEach-Object { $errorLines.Add("$_") }
    $errorLines.Add("")
    Write-Host "  [WARN] docker compose down exited with code $code" -ForegroundColor Yellow
}
else {
    Write-Host "  Done." -ForegroundColor Green
}
Write-Host ""

# --- Step 2: docker system prune ---
Write-Host "Pruning unused Docker objects..." -ForegroundColor Yellow
$output = docker system prune -f 2>&1
$code = $LASTEXITCODE
$output | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }

if ($code -ne 0) {
    $failed = $true
    $errorLines.Add("=== docker system prune -f (exit $code) ===")
    $output | ForEach-Object { $errorLines.Add("$_") }
    $errorLines.Add("")
    Write-Host "  [WARN] docker system prune exited with code $code" -ForegroundColor Yellow
}
else {
    Write-Host "  Done." -ForegroundColor Green
}
Write-Host ""

# --- Step 3: WSL shutdown ---
Write-Host "Shutting down WSL..." -ForegroundColor Yellow
$output = wsl --shutdown 2>&1
$code = $LASTEXITCODE
$output | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }

if ($code -ne 0) {
    $failed = $true
    $errorLines.Add("=== wsl --shutdown (exit $code) ===")
    $output | ForEach-Object { $errorLines.Add("$_") }
    $errorLines.Add("")
    Write-Host "  [WARN] wsl --shutdown exited with code $code" -ForegroundColor Yellow
}
else {
    Write-Host "  Done." -ForegroundColor Green
}
Write-Host ""

# --- Step 4: Compact VHDX ---
Write-Host "Compacting Docker VHDX..." -ForegroundColor Yellow
$vhdxPath = "$env:LOCALAPPDATA\Docker\wsl\disk\docker_data.vhdx"

if (-not (Test-Path $vhdxPath)) {
    Write-Host "  VHDX not found at: $vhdxPath -- skipping." -ForegroundColor Yellow
}
else {
    $output = Optimize-VHD -Path $vhdxPath -Mode Full 2>&1
    $code = $LASTEXITCODE
    $output | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }

    if ($code -ne 0) {
        $failed = $true
        $errorLines.Add("=== Optimize-VHD (exit $code) ===")
        $errorLines.Add("Path: $vhdxPath")
        $output | ForEach-Object { $errorLines.Add("$_") }
        $errorLines.Add("")
        Write-Host "  [WARN] Optimize-VHD exited with code $code" -ForegroundColor Yellow
    }
    else {
        Write-Host "  Done." -ForegroundColor Green
    }
}
Write-Host ""

# --- Result ---
if (-not $failed) {
    Set-Content $artifact ""
    Write-Host "  ==========================================" -ForegroundColor Green
    Write-Host "         PRUNE COMPLETE                      " -ForegroundColor Green
    Write-Host "  ==========================================" -ForegroundColor Green
    Write-Host ""
    exit 0
}

$header = @(
    "Failed task: Docker: Prune + Compact VHDX"
    "Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    ""
)
($header + $errorLines) | Set-Content $artifact

Write-Host "Errors written to: $artifact" -ForegroundColor Red
Write-Host ""
Write-Host "  ==========================================" -ForegroundColor Red
Write-Host "         PRUNE HAD ERRORS                    " -ForegroundColor Red
Write-Host "  ==========================================" -ForegroundColor Red
Write-Host ""
exit 1
