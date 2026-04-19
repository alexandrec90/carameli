# Runs lint, pytest, and E2E checks in sequence.
# For each check type, if failures are detected:
#   1. Call copilot haiku with <skill> known-only  -- fast pass for recognized patterns.
#   2. If unknown errors remain in the log, call copilot sonnet with <skill> -- full pass.
#   3. Re-run the check.
#   4. Repeat up to MAX_RETRIES times, then give up and move on.
#
# Usage:
#   .\scripts\check-and-fix-known.ps1

$ErrorActionPreference = "Continue"

$MAX_RETRIES = 3
$MODEL_CHEAP = "claude-haiku-4.5"    # fast model for known-pattern pass
$MODEL_FULL = "claude-sonnet-4.6"   # full model for unknown errors
$branchCreated = $false

# Structured run log -- written to logs/agent/ for optimize-fixers analysis.
$script:runLog = [ordered]@{
    run_at      = (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss')
    models      = [ordered]@{ cheap = $MODEL_CHEAP; full = $MODEL_FULL }
    max_retries = $MAX_RETRIES
    checks      = [System.Collections.Generic.List[object]]::new()
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

function Initialize-SandboxBranch {
    if ($script:branchCreated) { return }
    $branch = "auto-fix/$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    git checkout -b $branch
    if ($LASTEXITCODE -ne 0) {
        Write-Host "WARNING: Could not create sandbox branch -- running on current branch." -ForegroundColor Yellow
    }
    else {
        Write-Host "Sandbox branch: $branch" -ForegroundColor DarkGray
    }
    $script:branchCreated = $true
}

# Returns $true when the log exists, is non-empty, and has NOT been stamped
# "--- ADDRESSED" -- meaning unknown errors remain for the expensive model.
function Test-LogHasUnaddressedError {
    param ([string]$LogPath)
    if (-not (Test-Path $LogPath)) { return $false }
    $content = Get-Content $LogPath -Raw -ErrorAction SilentlyContinue
    if ([string]::IsNullOrWhiteSpace($content)) { return $false }
    return -not $content.TrimEnd().EndsWith('--- ADDRESSED')
}

# Runs one check script and, on failure, loops through haiku -> sonnet -> re-check
# until the check passes or MAX_RETRIES is exhausted.
function Invoke-CheckAndFix {
    param (
        [string]$Label,      # display label, e.g. "[1/3] Lint"
        [string]$Script,     # filename under scripts/, e.g. "lint-all.ps1"
        [string]$LogPath,    # artifact path read to detect unknown errors
        [string]$FixSkill,   # copilot skill name, e.g. "fix-lint"
        [switch]$RestartApp  # restart Docker app container before re-running check
    )

    Write-Host ""
    Write-Host "=== $Label ===" -ForegroundColor Cyan
    & pwsh -ExecutionPolicy Bypass -File "$PSScriptRoot\$Script"

    $checkLog = [ordered]@{
        label        = $Label
        skill        = $FixSkill
        restart_app  = $RestartApp.IsPresent
        initial_pass = $false
        attempts     = [System.Collections.Generic.List[object]]::new()
        final_pass   = $false
    }

    if ($LASTEXITCODE -eq 0) {
        Write-Host "$Label PASSED" -ForegroundColor Green
        $checkLog.initial_pass = $true
        $checkLog.final_pass = $true
        $script:runLog.checks.Add($checkLog)
        return $true
    }

    Write-Host "$Label FAILED -- starting fix loop (up to $MAX_RETRIES retries)" -ForegroundColor Yellow
    Initialize-SandboxBranch

    # Baselines for change detection (requirements rebuild + migration detection)
    $rootDir = Resolve-Path "$PSScriptRoot\.."
    $reqFile = Join-Path $rootDir "requirements.txt"
    $migDir = Join-Path $rootDir "alembic\versions"
    $reqHashSnap = if ($RestartApp -and (Test-Path $reqFile)) { (Get-FileHash $reqFile -Algorithm SHA256).Hash } else { $null }
    $migCountSnap = if ($RestartApp -and (Test-Path $migDir)) { (Get-ChildItem "$migDir\*.py" -ErrorAction SilentlyContinue).Count } else { 0 }

    for ($attempt = 1; $attempt -le $MAX_RETRIES; $attempt++) {
        Write-Host ""
        Write-Host "  [$attempt/$MAX_RETRIES] $Label -- fix attempt" -ForegroundColor DarkYellow

        $attemptLog = [ordered]@{
            attempt                     = $attempt
            cheap_invoked               = $true
            had_unaddressed_before_full = $false
            full_invoked                = $false
            restart_triggered           = $false
            rebuild_triggered           = $false
            migrate_triggered           = $false
            docker_fix_triggered        = $false
            passed_after                = $false
        }

        # Step 1: cheap model handles known patterns -- fast pass
        Write-Host "  [$MODEL_CHEAP] $FixSkill known-only ..." -ForegroundColor DarkGray
        copilot -p "$FixSkill known-only" --model $MODEL_CHEAP --yolo

        # Step 2: if unknown errors remain, escalate to full model
        if (Test-LogHasUnaddressedError -LogPath $LogPath) {
            $attemptLog.had_unaddressed_before_full = $true
            $attemptLog.full_invoked = $true
            Write-Host "  [$MODEL_FULL] Unknown errors remain -- running $FixSkill (full) ..." -ForegroundColor DarkGray
            copilot -p "$FixSkill" --model $MODEL_FULL --yolo
        }
        else {
            Write-Host "  [$MODEL_CHEAP] All errors matched known fixes -- full model not needed." -ForegroundColor DarkGray
        }

        # Step 3: detect what changed and take appropriate action
        if ($RestartApp) {
            $newReqHash = if (Test-Path $reqFile) { (Get-FileHash $reqFile -Algorithm SHA256).Hash } else { $null }
            $newMigCount = if (Test-Path $migDir) { (Get-ChildItem "$migDir\*.py" -ErrorAction SilentlyContinue).Count } else { 0 }

            $reqChanged = $newReqHash -ne $reqHashSnap
            $migAdded = $newMigCount -gt $migCountSnap

            if ($reqChanged) {
                Write-Host "  requirements.txt changed -- rebuilding Docker image ..." -ForegroundColor Yellow
                $attemptLog.rebuild_triggered = $true
                $attemptLog.restart_triggered = $true
                docker compose build app
                & pwsh -ExecutionPolicy Bypass -File "$PSScriptRoot\docker-restart-app.ps1"
            }
            else {
                Write-Host "  Restarting app container so fixes take effect ..." -ForegroundColor DarkGray
                $attemptLog.restart_triggered = $true
                & pwsh -ExecutionPolicy Bypass -File "$PSScriptRoot\docker-restart-app.ps1"
            }

            if ($migAdded) {
                Write-Host "  New migration detected -- applying migrations ..." -ForegroundColor Yellow
                $attemptLog.migrate_triggered = $true
                & pwsh -ExecutionPolicy Bypass -File "$PSScriptRoot\docker-migrate.ps1"
            }

            # Check Docker stack health after any container operation.
            # A rebuild or migration can leave containers unhealthy; catch it now
            # rather than letting pytest fail with a misleading error.
            Write-Host "  Checking Docker stack health after container operations ..." -ForegroundColor DarkGray
            & pwsh -ExecutionPolicy Bypass -File "$PSScriptRoot\docker-status.ps1"

            $healthLog = Join-Path $rootDir "logs\docker\health.log"
            if (Test-Path $healthLog) {
                $healthContent = Get-Content $healthLog -Raw -ErrorAction SilentlyContinue
                if ($healthContent -match "Unhealthy|Exited|exited|Restarting|FAIL") {
                    Write-Host "  Docker health issues detected -- running fix-docker ..." -ForegroundColor Yellow
                    $attemptLog.docker_fix_triggered = $true
                    copilot -p "fix-docker" --model $MODEL_FULL --yolo
                }
            }

            # Refresh baselines for next iteration
            $reqHashSnap = $newReqHash
            $migCountSnap = $newMigCount
        }

        # Step 4: verify fixes
        Write-Host "  Re-running $Label ..." -ForegroundColor DarkGray
        & pwsh -ExecutionPolicy Bypass -File "$PSScriptRoot\$Script"

        if ($LASTEXITCODE -eq 0) {
            $attemptLog.passed_after = $true
            $checkLog.attempts.Add($attemptLog)
            $checkLog.final_pass = $true
            $script:runLog.checks.Add($checkLog)
            Write-Host "$Label PASSED after $attempt attempt(s)" -ForegroundColor Green
            return $true
        }

        $checkLog.attempts.Add($attemptLog)

        if ($attempt -lt $MAX_RETRIES) {
            Write-Host "  Still failing -- retrying ..." -ForegroundColor Yellow
        }
    }

    $script:runLog.checks.Add($checkLog)
    Write-Host "$Label STILL FAILING after $MAX_RETRIES attempt(s) -- giving up." -ForegroundColor Red
    return $false
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

$logsDir = "$PSScriptRoot\..\logs"

$lintOk = Invoke-CheckAndFix `
    -Label    "[1/3] Lint" `
    -Script   "lint-all.ps1" `
    -LogPath  "$logsDir\lint-errors.log" `
    -FixSkill "fix-lint"

$testsOk = Invoke-CheckAndFix `
    -Label      "[2/3] pytest" `
    -Script     "run-tests.ps1" `
    -LogPath    "$logsDir\test-failures.log" `
    -FixSkill   "fix-tests" `
    -RestartApp

$e2eOk = Invoke-CheckAndFix `
    -Label    "[3/3] E2E" `
    -Script   "run-e2e.ps1" `
    -LogPath  "$logsDir\e2e-failures.log" `
    -FixSkill "fix-e2e"

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

Write-Host ""
if ($lintOk -and $testsOk -and $e2eOk) {
    Write-Host "=== All checks PASSED ===" -ForegroundColor Green
    $script:runLog.overall_pass = $true
}
else {
    Write-Host "=== Checks finished with failures ===" -ForegroundColor Red
    if (-not $lintOk) { Write-Host "  Lint:   FAILED" -ForegroundColor Red }
    if (-not $testsOk) { Write-Host "  pytest: FAILED" -ForegroundColor Red }
    if (-not $e2eOk) { Write-Host "  E2E:    FAILED" -ForegroundColor Red }
    $script:runLog.overall_pass = $false
}

# Write structured run log for optimize-fixers analysis.
$agentLogDir = "$PSScriptRoot\..\logs\agent"
if (-not (Test-Path $agentLogDir)) { New-Item -ItemType Directory -Path $agentLogDir -Force | Out-Null }
$logFile = Join-Path $agentLogDir "check-and-fix-$(Get-Date -Format 'yyyyMMdd-HHmmss').json"
$script:runLog | ConvertTo-Json -Depth 6 | Set-Content $logFile -Encoding UTF8
Write-Host "Run log: $logFile" -ForegroundColor DarkGray

if ($script:runLog.overall_pass) { exit 0 } else { exit 1 }
