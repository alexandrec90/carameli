# Runs Playwright E2E tests on the host (not inside Docker).
# Requires: pip install pytest-playwright && playwright install --with-deps chromium
# Requires: docker compose up  (backend)  +  cd frontend && npm run dev  (Vite)
#
# On failure: writes actionable error details to logs/e2e-failures.log for AI-agent consumption.
# On pass: clears the artifact. Terminal shows per-test results and a final banner.
#
# Usage:
#   .\scripts\run-e2e.ps1            # headless
#   .\scripts\run-e2e.ps1 -Headed    # watch in browser

param(
    [switch]$Headed
)

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$artifact = "logs/e2e-failures.log"
if (-not (Test-Path "logs")) { New-Item -ItemType Directory -Path "logs" | Out-Null }

$venvPython = Join-Path $PSScriptRoot ".." ".venv" "Scripts" "python.exe"
if (-not (Test-Path $venvPython)) {
    Write-Error "Venv not found at .venv/ -- create it first: python -m venv .venv"
    exit 1
}

$mode = if ($Headed) { "headed" } else { "headless" }

Write-Host ""
Write-Host "=== Carameli E2E Tests ===" -ForegroundColor Cyan
Write-Host "Artifact : $((Resolve-Path $artifact -ErrorAction SilentlyContinue) ?? (Join-Path $PWD $artifact))" -ForegroundColor DarkGray
Write-Host "Runner   : Playwright (chromium, $mode)" -ForegroundColor DarkGray
Write-Host "Tests    : tests/e2e/" -ForegroundColor DarkGray
Write-Host ""

# --- Pre-flight: verify both servers are reachable before running tests ---
# Vite dev server check (localhost:5173)
$viteReady = $false
try {
    $null = Invoke-WebRequest -Uri "http://localhost:5173" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
    $viteReady = $true
}
catch { Write-Verbose "Vite server not reachable: $_" }

# Backend health check (direct, bypassing Vite proxy)
$backendReady = $false
try {
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:8000/health" -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    $backendReady = ($resp.StatusCode -eq 200)
}
catch { Write-Verbose "Backend not reachable: $_" }

if (-not $viteReady -or -not $backendReady) {
    Set-Content $artifact "" -Encoding utf8
    Write-Host ""
    Write-Host "  [environment] E2E skipped -- one or more servers are not reachable." -ForegroundColor Yellow
    if (-not $viteReady) {
        Write-Host "    Frontend (Vite) is DOWN at http://localhost:5173" -ForegroundColor DarkGray
        Write-Host "      cd frontend && npm run dev" -ForegroundColor DarkGray
    }
    if (-not $backendReady) {
        Write-Host "    Backend is DOWN or unhealthy at http://127.0.0.1:8000/health" -ForegroundColor DarkGray
        Write-Host "      docker compose up" -ForegroundColor DarkGray
    }
    Write-Host ""
    exit 0
}

# Run pytest with verbose + short tracebacks + no header/warnings for cleaner parsing
$e2eArgs = @("-m", "pytest", "tests/e2e/", "-v", "--tb=short", "--no-header", "-p", "no:warnings")
if ($Headed) { $e2eArgs += "--headed" }

Write-Host "Running E2E tests..." -ForegroundColor Yellow
Write-Host "  Collecting tests " -ForegroundColor DarkGray -NoNewline

$sw = [System.Diagnostics.Stopwatch]::StartNew()
$lines = [System.Collections.Generic.List[string]]::new()
$failCount = 0
$passCount = 0
$skipCount = 0
$collecting = $true

# Stream pytest output in real-time, showing progress per-test.
& $venvPython @e2eArgs 2>&1 | ForEach-Object {
    $line = "$_"
    $lines.Add($line)

    # First real output line means collection is done
    if ($collecting -and $line -match "(PASSED|FAILED|ERROR|SKIPPED|collected)") {
        $collecting = $false
        $collectTime = "{0:0.0}s" -f $sw.Elapsed.TotalSeconds
        Write-Host " ($collectTime)" -ForegroundColor DarkGray
        Write-Host ""
    }

    # Verbose pytest lines: tests/e2e/test_smoke.py::test_name[browser] PASSED
    if ($line -match "^(tests[\\/].+?::\S+)\s+(PASSED|FAILED|SKIPPED|ERROR|XFAIL|XPASS)") {
        $name = $Matches[1] -replace '^tests[\\/]e2e[\\/]', ''
        switch ($Matches[2]) {
            "PASSED" {
                $passCount++
                Write-Host "  [pass] $name" -ForegroundColor Green
            }
            "FAILED" {
                $failCount++
                Write-Host "  [FAIL] $name" -ForegroundColor Red
            }
            "ERROR" {
                $failCount++
                Write-Host "  [FAIL] $name" -ForegroundColor Red
            }
            "SKIPPED" {
                $skipCount++
                Write-Host "  [skip] $name" -ForegroundColor DarkGray
            }
            default {
                $skipCount++
                Write-Host "  [skip] $name ($($Matches[2]))" -ForegroundColor DarkGray
            }
        }
    }
    elseif ($collecting) {
        Write-Host "." -ForegroundColor DarkGray -NoNewline
    }
}
$exitCode = $LASTEXITCODE
if ($collecting) { Write-Host "" }
$sw.Stop()
$elapsed = "{0:mm\:ss}" -f $sw.Elapsed

# Fallback: if no test results were parsed, show raw output
if (($passCount + $failCount + $skipCount) -eq 0) {
    Write-Host "  (no test results parsed -- raw output follows)" -ForegroundColor Yellow
    foreach ($line in $lines) {
        if ($line.Trim() -ne "") { Write-Host "  $line" }
    }
}

# --- Helpers for structured artifact ---

# Infer a specific fix hint from the collected error lines of a failure block.
function Get-FixHint([string[]]$errorLines) {
    $blob = $errorLines -join "`n"
    if ($blob -match "CORS policy|Access-Control-Allow-Origin") {
        return "CORS misconfiguration -- ensure Access-Control-Allow-Origin is not wildcard '*' when credentials mode is 'include'"
    }
    if ($blob -match "status[=\s]+5\d\d|Internal Server Error|502|503") {
        return "backend endpoint returning 5xx -- check the route handler and server logs"
    }
    if ($blob -match "status[=\s]+4\d\d|Not Found|Forbidden|Unauthorized") {
        return "backend endpoint returning 4xx -- check auth, route registration, and request payload"
    }
    if ($blob -match "Timeout|TimeoutError|waiting for selector|waiting for navigation") {
        return "page element or navigation timed out -- check that the app renders the expected DOM"
    }
    if ($blob -match "net::ERR_CONNECTION_REFUSED|ECONNREFUSED|net::ERR_EMPTY_RESPONSE|socket hang up") {
        return "server not reachable -- ensure the backend and frontend dev servers are running before running E2E tests"
    }
    if ($blob -match "ElementNotFound|ElementHandle|locator\.") {
        return "DOM element not found -- check selectors against the current page markup"
    }
    return "read the test to understand intent, then fix the underlying application code"
}

# Strip pytest diff noise from error lines (keep file:line context + first assertion error).
function Remove-DiffNoise([System.Collections.Generic.List[string]]$block) {
    $cleaned = [System.Collections.Generic.List[string]]::new()
    $hitAssertion = $false
    foreach ($l in $block) {
        # Always keep file:line context and code lines
        if ($l -match "^\S.*:\d+:" -or ($l -match "^\s{4}\S" -and -not $l.StartsWith("E "))) {
            $cleaned.Add($l)
            continue
        }
        # Keep the first E line(s) up to the assertion message
        if (-not $hitAssertion -and ($l -match "^E\s+Assertion|^E\s+assert|^E\s+\+\s+where|^E\s+.*Error:")) {
            # Truncate very long E lines (e.g., giant list dumps) to 300 chars
            if ($l.Length -gt 300) {
                $cleaned.Add($l.Substring(0, 297) + "...")
            }
            else {
                $cleaned.Add($l)
            }
            $hitAssertion = $true
            continue
        }
        # After the assertion: keep only `+  where` context lines, drop everything else
        if ($hitAssertion -and $l -match "^E\s+\+\s+where") {
            if ($l.Length -gt 300) {
                $cleaned.Add($l.Substring(0, 297) + "...")
            }
            else {
                $cleaned.Add($l)
            }
            continue
        }
        # Drop all other E lines after the assertion (diff noise, redundant assert repr, etc.)
        if ($hitAssertion -and $l -match "^E\s") {
            continue
        }
        # Keep other E lines that appear before the assertion
        if ($l.StartsWith("E ") -and -not $hitAssertion) {
            if ($l.Length -gt 300) {
                $cleaned.Add($l.Substring(0, 297) + "...")
            }
            else {
                $cleaned.Add($l)
            }
        }
    }
    return $cleaned
}

# --- Detect environment errors (server not running) ---
# Per diagnostics.md §3: environment errors must not be written to the artifact.
# Detect them here and bail out with a terminal-only note.
$allOutput = $lines -join "`n"
$serverDown = (
    $failCount -gt 0 -and
    ($allOutput -match "net::ERR_EMPTY_RESPONSE|net::ERR_CONNECTION_REFUSED|ECONNREFUSED|socket hang up") -and
    # All failures must be connection-type errors (no assertion errors or 4xx/5xx)
    ($allOutput -notmatch "AssertionError|assert |status[=\s]+[45]\d\d")
)
if ($serverDown) {
    Set-Content $artifact "" -Encoding utf8
    Write-Host ""
    Write-Host "  [environment] E2E skipped -- frontend or backend dev server is not reachable." -ForegroundColor Yellow
    Write-Host "  Start both servers before running E2E tests:" -ForegroundColor Yellow
    Write-Host "    docker compose up        # backend" -ForegroundColor DarkGray
    Write-Host "    cd frontend && npm run dev  # Vite on :5173" -ForegroundColor DarkGray
    Write-Host ""
    exit $exitCode
}

# --- Build structured artifact for coding agent ---
if ($exitCode -ne 0 -and $failCount -gt 0) {
    $sections = [System.Collections.Generic.List[string]]::new()

    # Extract failure blocks from pytest output.
    # With --tb=short, each failure block looks like:
    #   _______ test_name[browser] _______
    #   file.py:line: in test_func
    #       <code line>
    #   E   AssertionError: ...
    #   _______ next_test ...
    $inFailureBlock = $false
    $currentTest = ""
    $currentLines = [System.Collections.Generic.List[string]]::new()

    foreach ($line in $lines) {
        # Failure block header: _______ test_name[param] _______
        if ($line -match "^_{3,}\s+(.+?)\s+_{3,}$") {
            # Flush previous block
            if ($currentTest -ne "" -and $currentLines.Count -gt 0) {
                $cleaned = Remove-DiffNoise $currentLines
                $sections.Add("# $currentTest")
                $sections.Add("# fix: $(Get-FixHint $currentLines)")
                $sections.AddRange([string[]]$cleaned)
                $sections.Add("")
            }
            $currentTest = $Matches[1]
            $currentLines = [System.Collections.Generic.List[string]]::new()
            $inFailureBlock = $true
            continue
        }

        # End of failures section
        if ($inFailureBlock -and $line -match "^={3,}\s+(short test summary|warnings summary)") {
            $inFailureBlock = $false
            continue
        }

        if ($inFailureBlock -and $line.Trim() -ne "") {
            # Skip pytest noise lines
            if ($line -match "^(FAILED|={3,}|\.venv|--\s+Docs:)") { continue }
            $currentLines.Add($line)
        }
    }

    # Flush last block
    if ($currentTest -ne "" -and $currentLines.Count -gt 0) {
        $cleaned = Remove-DiffNoise $currentLines
        $sections.Add("# $currentTest")
        $sections.Add("# fix: $(Get-FixHint $currentLines)")
        $sections.AddRange([string[]]$cleaned)
        $sections.Add("")
    }

    # Append the short test summary (FAILED lines with file:line references)
    $summaryLines = @($lines | Where-Object { $_ -match "^FAILED\s+" })
    if ($summaryLines.Count -gt 0) {
        $sections.Add("# summary")
        $sections.AddRange([string[]]$summaryLines)
        $sections.Add("")
    }

    if ($sections.Count -gt 0) {
        $sections | Set-Content $artifact -Encoding utf8
    }
    else {
        # Fallback: write filtered output (strip warnings + docs links)
        $filtered = @($lines | Where-Object {
                $_ -notmatch "^\.venv" -and
                $_ -notmatch "^--\s+Docs:" -and
                $_ -notmatch "Warning:" -and
                $_ -notmatch "PytestConfigWarning" -and
                $_.Trim() -ne ""
            })
        $filtered | Set-Content $artifact -Encoding utf8
    }
}
elseif ($exitCode -ne 0) {
    # Non-test failure (e.g., import error, collection error)
    $filtered = @($lines | Where-Object {
            $_ -notmatch "^\.venv" -and
            $_ -notmatch "^--\s+Docs:" -and
            $_.Trim() -ne ""
        })
    $sections = [System.Collections.Generic.List[string]]::new()
    $sections.Add("# e2e-collection-error")
    $sections.Add("# fix: check that all test imports resolve and fixtures are available")
    $sections.AddRange([string[]]$filtered)
    $sections | Set-Content $artifact -Encoding utf8
}
else {
    Set-Content $artifact "" -Encoding utf8
}

# --- Final banner ---
Write-Host ""
$total = $passCount + $failCount + $skipCount
Write-Host "Results: $passCount passed, $failCount failed, $skipCount skipped ($total total, $elapsed)" -ForegroundColor DarkGray
Write-Host ""
if ($exitCode -ne 0) {
    Write-Host "Errors written to: $artifact" -ForegroundColor Red
    Write-Host ""
    Write-Host "  ==========================================" -ForegroundColor Red
    Write-Host "              E2E FAILED                     " -ForegroundColor Red
    Write-Host "  ==========================================" -ForegroundColor Red
    Write-Host ""
}
else {
    Write-Host ""
    Write-Host "  ==========================================" -ForegroundColor Green
    Write-Host "              E2E PASSED                     " -ForegroundColor Green
    Write-Host "  ==========================================" -ForegroundColor Green
    Write-Host ""
}

exit $exitCode
