# Runs pytest inside the app container.
# On failure: writes only the failures section to logs/test-failures.log.
# On pass: clears the artifact. Terminal exits when done.
#
# Usage:
#   run-tests.ps1           Full suite (parallel via xdist)
#   run-tests.ps1 -Fast     Changed-only (single process via testmon)
param(
    [switch]$Fast
)
$ErrorActionPreference = "Continue"

$artifact = "logs/test-failures.log"
if (-not (Test-Path "logs")) { New-Item -ItemType Directory -Path "logs" | Out-Null }

# Build the pytest command based on mode.
if ($Fast) {
    # testmon selection (--testmon) is incompatible with xdist, so override addopts
    # to drop -n/--dist during the dry-run collect.
    # If testmon selects more than half the suite, fall back to xdist for speed
    # but keep --testmon-noselect so the DB gets updated (breaks the stale-DB loop).
    $collectCmd = "pytest --collect-only -q -o addopts='--ignore=tests/e2e' --testmon 2>/dev/null | tail -1"
    $totalCmd   = "pytest --collect-only -q -o addopts='--ignore=tests/e2e' 2>/dev/null | tail -1"

    Write-Host "  Checking testmon selection..." -ForegroundColor DarkGray
    $selectedRaw = docker compose exec -T app bash -c "$collectCmd" 2>&1 | Select-Object -Last 1
    $totalRaw    = docker compose exec -T app bash -c "$totalCmd" 2>&1 | Select-Object -Last 1

    $selected = if ($selectedRaw -match "(\d+)\s+(selected|test)") { [int]$Matches[1] } else { 999 }
    $total    = if ($totalRaw    -match "(\d+)\s+(selected|test)") { [int]$Matches[1] } else { 1 }

    if ($total -gt 0 -and $selected -gt [Math]::Ceiling($total / 2)) {
        Write-Host "  testmon selected $selected/$total tests -- falling back to xdist" -ForegroundColor Yellow
        $pytestCmd = "pytest -v --tb=short --no-header -n auto --testmon-noselect"
        $modeLabel = "full (xdist fallback -- testmon-noselect to update DB)"
    } elseif ($selected -eq 0) {
        Write-Host "  testmon: 0 tests to run (no changes detected)" -ForegroundColor Green
        $pytestCmd = "pytest -v --tb=short --no-header -o addopts='--ignore=tests/e2e' --testmon"
        $modeLabel = "fast (changed-only, testmon -- 0 selected)"
    } else {
        Write-Host "  testmon: $selected/$total tests selected" -ForegroundColor Green
        $pytestCmd = "pytest -v --tb=short --no-header -o addopts='--ignore=tests/e2e' --testmon"
        $modeLabel = "fast (changed-only, testmon)"
    }
} else {
    $pytestCmd = "pytest -v --tb=short --no-header -n auto"
    $modeLabel = "full (parallel, xdist)"
}

Write-Host ""
Write-Host "=== Carameli Test Suite ===" -ForegroundColor Cyan
Write-Host "Mode     : $modeLabel" -ForegroundColor DarkGray
Write-Host "Artifact : $((Resolve-Path $artifact -ErrorAction SilentlyContinue) ?? (Join-Path $PWD $artifact))" -ForegroundColor DarkGray
Write-Host "Command  : docker compose exec app $pytestCmd" -ForegroundColor DarkGray
Write-Host ""

Write-Host "Running pytest ($modeLabel)..." -ForegroundColor Yellow
Write-Host "  Collecting tests " -ForegroundColor DarkGray -NoNewline

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$lines = [System.Collections.Generic.List[string]]::new()
$passed = 0; $failed = 0; $errors = 0
$collecting = $true

# Stream pytest output in real-time, showing progress per-test.
# switch -Regex short-circuits on first match per line, avoiding redundant checks.
docker compose exec app bash -c "$pytestCmd" 2>&1 | ForEach-Object {
    $line = "$_"
    $lines.Add($line)

    # First real output line means collection is done
    if ($collecting -and $line -match "(PASSED|FAILED|ERROR|collected)") {
        $collecting = $false
        $collectTime = "{0:0.0}s" -f $sw.Elapsed.TotalSeconds
        Write-Host " ($collectTime)" -ForegroundColor DarkGray
        Write-Host ""
    }

    switch -Regex ($line) {
        " PASSED" {
            $passed++
            Write-Host "  pass " -ForegroundColor Green -NoNewline
            Write-Host ($line -replace " PASSED.*$","")
            break
        }
        " FAILED" {
            $failed++
            Write-Host "  FAIL " -ForegroundColor Red -NoNewline
            Write-Host ($line -replace " FAILED.*$","")
            break
        }
        "^FAILED " {
            # Summary line (e.g. "FAILED tests/...::test_name") -- already counted above
            break
        }
        "^ERROR " {
            $errors++
            break
        }
        "^collected" {
            Write-Host "  $line" -ForegroundColor DarkGray
            break
        }
        default {
            if ($collecting) {
                Write-Host "." -ForegroundColor DarkGray -NoNewline
            }
        }
    }
}
$exitCode = $LASTEXITCODE
if ($collecting) { Write-Host "" }
$sw.Stop()
$elapsed = "{0:mm\:ss}" -f $sw.Elapsed

Write-Host ""
Write-Host "  $passed passed, $failed failed, $errors errors ($elapsed)" -ForegroundColor DarkGray
Write-Host ""
if ($exitCode -eq 0) {
    Set-Content $artifact ""
    Write-Host "  [pass] pytest ($elapsed)" -ForegroundColor Green
    Write-Host ""
    Write-Host "  ==========================================" -ForegroundColor Green
    Write-Host "             TESTS PASSED                    " -ForegroundColor Green
    Write-Host "  ==========================================" -ForegroundColor Green
    Write-Host ""
    exit 0
}

Write-Host "  [FAIL] pytest ($elapsed)" -ForegroundColor Red

# ---------------------------------------------------------------------------
# Build a compact artifact: for each failure/error keep only:
#   - the section header (test name)
#   - frames pointing to YOUR code (tests/ or app/)
#   - the E-prefixed error lines (the actual assertion / exception message)
#   - exception group content (schemathesis |/+ lines), minus library frames
#   - WARNING/ERROR/CRITICAL captured log lines (INFO/DEBUG dropped as fixture noise)
#   - the short-test-summary and final stats line
# Library internals (sqlalchemy/, asyncpg/, schemathesis/, etc.) are dropped.
# INFO/DEBUG log output (app start/stop, routine messages) is dropped everywhere.
# Each failure block is capped at 25 lines to keep the file readable but complete.
# ---------------------------------------------------------------------------

$filtered = [System.Collections.Generic.List[string]]::new()
$inBlock = $false          # inside a FAILURES / ERRORS block
$blockLines = $null        # filtered lines for the current single test
$rawBlockLines = $null     # unfiltered lines for the current single test (fallback)
$maxPerBlock = 25          # max lines kept per failure/error

function Invoke-FlushBlock {
    if ($null -ne $script:blockLines -and $script:blockLines.Count -gt 0) {
        # If the filter produced nothing useful (only the ___ header), fall back to the
        # raw block lines so an AI agent always has traceback context to work from.
        $source = $script:blockLines
        $isRawFallback = $false
        if ($script:blockLines.Count -le 1 -and $null -ne $script:rawBlockLines -and $script:rawBlockLines.Count -gt 1) {
            $source = $script:rawBlockLines
            $isRawFallback = $true
        }
        if ($source.Count -gt $script:maxPerBlock) {
            $kept = $source.Count
            $source = [System.Collections.Generic.List[string]]::new(
                $source.GetRange(0, $script:maxPerBlock)
            )
            $source.Add("  ... ($kept lines total, truncated)")
        }
        if ($isRawFallback) {
            $source.Add("  [raw fallback: no first-party frames matched filter]")
        }
        foreach ($bl in $source) { $script:filtered.Add($bl) }
        $script:filtered.Add("")
    }
    $script:blockLines = [System.Collections.Generic.List[string]]::new()
    $script:rawBlockLines = [System.Collections.Generic.List[string]]::new()
}

for ($i = 0; $i -lt $lines.Count; $i++) {
    $l = $lines[$i]

    switch -Regex ($l) {
        "^={3,}\s+test session starts" {
            # Drop — adds no value for debugging
            break
        }
        "^={3,}\s+short test summary" {
            Invoke-FlushBlock
            $inBlock = $false
            $filtered.Add($l)
            break
        }
        "^={3,}\s+(FAILURES|ERRORS)\s+=" {
            $inBlock = $true
            $filtered.Add($l)
            break
        }
        "^_{3,}\s+" {
            Invoke-FlushBlock
            $blockLines.Add($l)
            $rawBlockLines.Add($l)
            break
        }
        default {
            if (-not $inBlock -and $l -match "^(FAILED |ERROR |=)" -and $l -notmatch "^\s*=+\s+\d+\s+(failed|passed|error)") {
                $filtered.Add($l)
            }
            elseif ($inBlock -and $null -ne $blockLines) {
                if ($l -match "^-+ Captured log call") {
                    # Keep only WARNING/ERROR/CRITICAL log lines — INFO/DEBUG are test fixture noise
                    while (++$i -lt $lines.Count) {
                        if ($lines[$i] -match "^(_{3,}|={3,}|-+ Captured)") { $i--; break }
                        if ($lines[$i] -match "^(WARNING|ERROR|CRITICAL)\s+") {
                            $blockLines.Add($lines[$i])
                            $rawBlockLines.Add($lines[$i])
                        }
                    }
                } elseif ($l -match "^-+ Captured (stderr|stdout)") {
                    while (++$i -lt $lines.Count) {
                        if ($lines[$i] -match "^(_{3,}|={3,}|-+ Captured)") { $i--; break }
                    }
                }
                else {
                    # Drop INFO/DEBUG captured-log noise entirely (app start/stop, etc.)
                    if ($l -match "^(INFO|DEBUG)\s+\S+:\S+\.py:\d+") {
                        # Test fixture noise — skip even from raw fallback
                    } else {
                        $rawBlockLines.Add($l)
                        if ($l -match "^E\s+") {
                            $blockLines.Add($l)
                        } elseif ($l -match "(tests/|app/).*\.py:\d+") {
                            $blockLines.Add($l)
                        } elseif ($l -match "^(WARNING|ERROR|CRITICAL)\s+") {
                            # Captured log without header — keep WARNING+ for context
                            $blockLines.Add($l)
                        } elseif ($l -match "^\s*[|+]") {
                            # Exception group lines (schemathesis, etc.)
                            # Drop: blank spacers, library frames
                            if ($l -match "^\s*\|\s*$") {
                                # Blank spacer line — skip
                            } elseif ($l -match 'File "' -and $l -notmatch "(tests/|app/)") {
                                # Library internal frame — skip
                            } else {
                                $blockLines.Add($l)
                            }
                        }
                    }
                }
            }
        }
    }
}
Invoke-FlushBlock

# Append the final stats line (e.g. "=== 58 failed, 49 passed ... ===")
for ($i = $lines.Count - 1; $i -ge 0; $i--) {
    if ($lines[$i] -match "^\s*=+\s+\d+\s+(failed|passed|error)") {
        $filtered.Add($lines[$i])
        break
    }
}

$filtered | Set-Content $artifact

Write-Host ""
Write-Host "Errors written to: $artifact" -ForegroundColor Red
Write-Host ""
Write-Host "  ==========================================" -ForegroundColor Red
Write-Host "             TESTS FAILED                    " -ForegroundColor Red
Write-Host "  ==========================================" -ForegroundColor Red
Write-Host ""
exit $exitCode
