# Mirrors the three GitHub CI jobs locally and writes a structured failure
# artifact at logs/ci-failures.log for agent consumption.
#
# Jobs mirrored:
#   [1/3] backend-tests   -- pytest tests/unit tests/integration (inside app container)
#   [2/3] frontend-checks -- npm ci + npm run build + npm run test
#   [3/3] browser-smoke   -- pytest tests/e2e --browser chromium (host, venv)
#
# Prerequisites:
#   - docker compose up  (app + db + redis must be running for jobs 1 and 3)
#   - For browser-smoke: playwright installed in .venv
#       pip install pytest-playwright && playwright install --with-deps chromium
#
# Usage:
#   .\scripts\run-ci.ps1              # all three jobs
#   .\scripts\run-ci.ps1 -SkipE2E    # skip browser-smoke (faster, no playwright needed)

param(
    [switch]$SkipE2E
)
$ErrorActionPreference = "Continue"

$artifact = "logs/ci-failures.log"
if (-not (Test-Path "logs")) { New-Item -ItemType Directory -Path "logs" | Out-Null }

$overallFailed = $false
$sections = [System.Collections.Generic.List[string]]::new()

# ---------------------------------------------------------------------------
# Helper: extract failure blocks from pytest -v --tb=short output.
# Drops library internal frames and INFO/DEBUG log captures.
# ---------------------------------------------------------------------------
function Get-PytestFailureSection {
    param([string]$JobName, [string[]]$Lines, [string]$FixCmd)

    $buf = [System.Collections.Generic.List[string]]::new()
    $buf.Add("")
    $buf.Add("# ================================================================")
    $buf.Add("# JOB: $JobName")
    $buf.Add("# ================================================================")
    $buf.Add("# pytest")
    $buf.Add("# fix: $FixCmd")

    $inFail = $false
    foreach ($ln in $Lines) {
        if ($ln -match "^=+\s+(FAILURES|ERRORS)\s+=+") {
            $inFail = $true
            $buf.Add($ln)
            continue
        }
        if (-not $inFail) { continue }
        # drop library internal frames
        if ($ln -match "site.packages|asyncpg|sqlalchemy|starlette|httpx|anyio|playwright._impl") { continue }
        # drop INFO/DEBUG captured log lines
        if ($ln -match "^\s{4,}(INFO|DEBUG)\s") { continue }
        $buf.Add($ln)
    }

    # fallback: no failure block found -- include short test summary lines
    if ($buf.Count -le 6) {
        $Lines | Where-Object { $_ -match "^(FAILED |short test summary)" } |
        ForEach-Object { $buf.Add($_) }
    }

    return , $buf.ToArray()
}

function Add-RawSection {
    param([string]$JobName, [string]$FixCmd, [string[]]$Lines)
    $sections.Add("")
    $sections.Add("# ================================================================")
    $sections.Add("# JOB: $JobName")
    $sections.Add("# ================================================================")
    $sections.Add("# fix: $FixCmd")
    $Lines | ForEach-Object { $sections.Add($_) }
}

# ---------------------------------------------------------------------------
# JOB 1 -- backend-tests
# CI command: pytest tests/unit tests/integration -v --tb=short --no-header
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== [1/3] backend-tests ===" -ForegroundColor Cyan

$beCmd = "pytest tests/unit tests/integration -v --tb=short --no-header"
Write-Host "  docker compose exec app $beCmd" -ForegroundColor DarkGray

$beOut = docker compose exec -T app bash -c "$beCmd" 2>&1 | ForEach-Object { "$_" }
$beExit = $LASTEXITCODE

# exit code 125 means the container isn't running
if ($beExit -eq 125) {
    Write-Host "  [skip] app container not running -- run 'docker compose up' first" -ForegroundColor Yellow
}
else {
    $bePassed = ($beOut | Where-Object { $_ -match " PASSED" }).Count
    $beFailed = ($beOut | Where-Object { $_ -match "^FAILED " }).Count
    if ($beExit -eq 0) {
        Write-Host "  [pass] $bePassed passed" -ForegroundColor Green
    }
    else {
        Write-Host "  [FAIL] $beFailed failed" -ForegroundColor Red
        $overallFailed = $true
        $sec = Get-PytestFailureSection -JobName "backend-tests" -Lines $beOut -FixCmd "docker compose exec app $beCmd"
        $sec | ForEach-Object { $sections.Add($_) }
    }
}

# ---------------------------------------------------------------------------
# JOB 2 -- frontend-checks
# CI commands: npm ci  ->  npm run build  ->  npm run test
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=== [2/3] frontend-checks ===" -ForegroundColor Cyan

Push-Location (Join-Path $PSScriptRoot ".." "frontend")

# -- npm ci --
Write-Host "  npm ci" -ForegroundColor DarkGray
$npmCiOut = & npm ci 2>&1 | ForEach-Object { "$_" }
$npmCiExit = $LASTEXITCODE

if ($npmCiExit -ne 0) {
    Write-Host "  [FAIL] npm ci" -ForegroundColor Red
    $overallFailed = $true
    $errLines = $npmCiOut | Where-Object { $_ -match "^npm (ERR!|error)" }
    Add-RawSection -JobName "frontend-checks (npm ci)" -FixCmd "cd frontend && npm ci" -Lines $errLines
}

# -- npm run build -- (only if npm ci succeeded)
if ($npmCiExit -eq 0) {
    Write-Host "  npm run build" -ForegroundColor DarkGray
    $buildOut = & npm run build 2>&1 | ForEach-Object { "$_" }
    $buildExit = $LASTEXITCODE

    if ($buildExit -ne 0) {
        Write-Host "  [FAIL] npm run build" -ForegroundColor Red
        $overallFailed = $true
        $errLines = $buildOut | Where-Object { $_ -match "(error TS|Error:| error )" }
        Add-RawSection -JobName "frontend-checks (npm run build)" -FixCmd "cd frontend && npm run build" -Lines $errLines
    }
}

# -- npm run test --
# Pass --run so Vitest exits immediately instead of entering watch mode.
Write-Host "  npm run test" -ForegroundColor DarkGray
$env:CI = "true"
$feOut = & npm run test -- --run 2>&1 | ForEach-Object { "$_" }
$feExit = $LASTEXITCODE
$env:CI = $null

$fePassLine = ($feOut | Where-Object { $_ -match "\d+ passed" } | Select-Object -Last 1) -replace "^\s+", ""
$feFailLine = ($feOut | Where-Object { $_ -match "\d+ failed" } | Select-Object -Last 1) -replace "^\s+", ""

if ($feExit -eq 0) {
    Write-Host "  [pass] $fePassLine" -ForegroundColor Green
}
else {
    Write-Host "  [FAIL] $feFailLine" -ForegroundColor Red
    $overallFailed = $true
    # keep FAIL lines, error messages, and the summary block
    $errLines = $feOut | Where-Object { $_ -match "^( FAIL| x |AssertionError|Error:|FAIL )" }
    Add-RawSection -JobName "frontend-checks (npm run test)" -FixCmd "cd frontend && npm run test -- --run" -Lines $errLines
}

Pop-Location

# ---------------------------------------------------------------------------
# JOB 3 -- browser-smoke (E2E)
# CI command: pytest tests/e2e -v --browser chromium
# Requires: docker compose up (app + frontend)  +  playwright in .venv
# ---------------------------------------------------------------------------
if (-not $SkipE2E) {
    Write-Host ""
    Write-Host "=== [3/3] browser-smoke ===" -ForegroundColor Cyan

    $python = Join-Path $PSScriptRoot ".." ".venv" "Scripts" "python.exe"
    if (-not (Test-Path $python)) { $python = "python" }

    $null = & $python -m playwright --version 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [skip] playwright not installed in .venv" -ForegroundColor Yellow
        Write-Host "         To enable: pip install pytest-playwright && playwright install --with-deps chromium" -ForegroundColor DarkGray
    }
    else {
        # Mirror the CI readiness loop: wait up to 5 minutes for both services.
        Write-Host "  Waiting for backend (:8000) and frontend (:5173)..." -ForegroundColor DarkGray
        $ready = $false
        for ($i = 1; $i -le 60; $i++) {
            $beReady = $false; $feReady = $false
            try { $null = Invoke-WebRequest -Uri http://localhost:8000/health -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop; $beReady = $true } catch { Write-Verbose "Backend not ready: $_" }
            try { $null = Invoke-WebRequest -Uri http://localhost:5173 -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop; $feReady = $true } catch { Write-Verbose "Frontend not ready: $_" }
            if ($beReady -and $feReady) { $ready = $true; break }
            Start-Sleep -Seconds 5
        }
        if (-not $ready) {
            Write-Host "  [skip] services not reachable after 5 minutes" -ForegroundColor Yellow
            Write-Host "         Start with: docker compose up  (backend)  +  cd frontend; npm run dev  (or docker compose up frontend)" -ForegroundColor DarkGray
        }
        else {
            $e2eArgs = @("tests/e2e", "-v", "--tb=short", "--browser", "chromium")
            Write-Host "  pytest $($e2eArgs -join ' ')" -ForegroundColor DarkGray

            $e2eOut = & $python -m pytest @e2eArgs 2>&1 | ForEach-Object { "$_" }
            $e2eExit = $LASTEXITCODE

            $e2ePassed = ($e2eOut | Where-Object { $_ -match " PASSED" }).Count
            $e2eFailed = ($e2eOut | Where-Object { $_ -match "^FAILED " }).Count
            $e2eCmd = "pytest tests/e2e -v --tb=short --browser chromium"

            if ($e2eExit -eq 0) {
                Write-Host "  [pass] $e2ePassed passed" -ForegroundColor Green
            }
            else {
                Write-Host "  [FAIL] $e2eFailed failed" -ForegroundColor Red
                $overallFailed = $true
                $sec = Get-PytestFailureSection -JobName "browser-smoke" -Lines $e2eOut -FixCmd $e2eCmd
                $sec | ForEach-Object { $sections.Add($_) }
            }
        } # end readiness guard
    }
}
else {
    Write-Host ""
    Write-Host "=== [3/3] browser-smoke ===" -ForegroundColor Cyan
    Write-Host "  [skip] -SkipE2E flag set" -ForegroundColor DarkGray
}

# ---------------------------------------------------------------------------
# Write artifact and summarize
# ---------------------------------------------------------------------------
Write-Host ""

if ($overallFailed) {
    $header = @(
        "# ci-failures -- $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
        "# Tell a coding agent: fix the CI failures in logs/ci-failures.log",
        ""
    )
    ($header + $sections.ToArray()) | Set-Content $artifact
    Write-Host "  ==========================================" -ForegroundColor Red
    Write-Host "          CI JOBS FAILED                     " -ForegroundColor Red
    Write-Host "  ==========================================" -ForegroundColor Red
    Write-Host ""
    Write-Host "  Artifact : $artifact" -ForegroundColor Yellow
    Write-Host "  Tell agent: fix the CI failures in logs/ci-failures.log" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}
else {
    Set-Content $artifact ""
    Write-Host "  ==========================================" -ForegroundColor Green
    Write-Host "         ALL CI JOBS PASSED                  " -ForegroundColor Green
    Write-Host "  ==========================================" -ForegroundColor Green
    Write-Host ""
    exit 0
}
