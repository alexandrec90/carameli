$ReportDir = "reports"
if (-not (Test-Path $ReportDir)) { New-Item -ItemType Directory -Path $ReportDir | Out-Null }

& ".venv\Scripts\mutmut.exe" run
if ($LASTEXITCODE -ne 0) {
	Write-Host "mutmut run returned a non-zero status (expected while mutation score target is still in progress)."
}

& ".venv\Scripts\mutmut.exe" results | Tee-Object -FilePath "$ReportDir\mutation-report.txt"

# Exit 0 even if mutants survived - surviving mutants are informational, not a hard failure.
# Change to "exit $LASTEXITCODE" once the score target (>80%) is met.
exit 0
