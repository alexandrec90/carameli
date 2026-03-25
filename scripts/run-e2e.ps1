# Runs Playwright E2E tests on the host (not inside Docker).
# Requires: pip install pytest-playwright && playwright install --with-deps chromium
# Requires: docker compose up  (backend)  +  cd frontend && npm run dev  (Vite)
#
# Usage:
#   .\scripts\run-e2e.ps1            # headless
#   .\scripts\run-e2e.ps1 -Headed    # watch in browser

param(
    [switch]$Headed
)

$ErrorActionPreference = "Continue"

$artifact = "logs/e2e-failures.log"
if (-not (Test-Path "logs")) { New-Item -ItemType Directory -Path "logs" | Out-Null }

$e2eArgs = @("tests/e2e/", "-v", "--tb=short")
if ($Headed) { $e2eArgs += "--headed" }

$output = & pytest @e2eArgs 2>&1
$exitCode = $LASTEXITCODE

if ($exitCode -eq 0) {
    Set-Content $artifact ""
    exit 0
}

# Capture failures section to artifact
$lines = $output | ForEach-Object { "$_" }
$startIdx = 0
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match "^(FAILED|ERROR\b|=+\s+(FAILURES|ERRORS))") {
        $startIdx = $i
        break
    }
}
$lines[$startIdx..($lines.Count - 1)] | Set-Content $artifact
exit $exitCode
