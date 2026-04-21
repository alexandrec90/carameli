param(
    [int]$Users = 10,
    [string]$SpawnRate = "2",
    [string]$RunTime = "1m",
    [string]$TargetHost = "http://localhost:8000"
)

$ReportDir = "reports"
if (-not (Test-Path $ReportDir)) { New-Item -ItemType Directory -Path $ReportDir | Out-Null }

& ".venv\Scripts\locust.exe" `
    -f tests/load/locustfile.py `
    --headless `
    -u $Users `
    -r $SpawnRate `
    --run-time $RunTime `
    --host $TargetHost `
    --html "$ReportDir\load-report.html" `
    --csv "$ReportDir\load"

exit $LASTEXITCODE
