param(
    [switch]$SkipE2E
)
$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "=== Stage 1: Backend tests ===" -ForegroundColor Cyan
docker compose exec -T app pytest tests/unit/ tests/integration/test_full_flows.py tests/integration/test_contract.py -x -q --tb=short
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "=== Stage 2: Frontend unit tests ===" -ForegroundColor Cyan
Push-Location (Join-Path $PSScriptRoot ".." "frontend")
npm run test:run
$frontendExit = $LASTEXITCODE
Pop-Location
if ($frontendExit -ne 0) { exit $frontendExit }

Write-Host ""
Write-Host "=== Stage 3: E2E smoke ===" -ForegroundColor Cyan
if ($SkipE2E) {
    Write-Host "Skipping E2E smoke because -SkipE2E was provided." -ForegroundColor Yellow
    Write-Host "=== All Tier 1 checks passed ===" -ForegroundColor Green
    exit 0
}

$frontendReady = $false
$curlExe = Get-Command curl.exe -ErrorAction SilentlyContinue
if ($null -ne $curlExe) {
    & curl.exe -s "http://localhost:5173" *> $null
    $frontendReady = ($LASTEXITCODE -eq 0)
}
else {
    try {
        $null = Invoke-WebRequest -Uri "http://localhost:5173" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
        $frontendReady = $true
    }
    catch {
        $frontendReady = $false
    }
}

if (-not $frontendReady) {
    Write-Host "Skipping E2E smoke because frontend dev server is not reachable at http://localhost:5173." -ForegroundColor Yellow
    Write-Host "=== All Tier 1 checks passed ===" -ForegroundColor Green
    exit 0
}

pytest tests/e2e/test_smoke.py --browser=chromium -q
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "=== All Tier 1 checks passed ===" -ForegroundColor Green
exit 0
