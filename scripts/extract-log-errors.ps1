# Extracts ERROR and WARNING lines from carameli.log (+ rotated backups),
# deduplicates by message, writes to logs/log-errors.log, then truncates
# the main log so fixed errors do not reappear on the next run.
$ErrorActionPreference = "Continue"

$logDir    = "logs"
$runtimeDir = "$logDir/runtime"
$mainLog   = "$runtimeDir/carameli.log"
$artifact  = "$logDir/log-errors.log"

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
if (-not (Test-Path $runtimeDir)) { New-Item -ItemType Directory -Path $runtimeDir | Out-Null }

Write-Host ""
Write-Host "=== Log Error Extraction ===" -ForegroundColor Cyan
Write-Host "Source   : $mainLog (+ rotated backups)" -ForegroundColor DarkGray
Write-Host "Artifact : $artifact" -ForegroundColor DarkGray
Write-Host ""

# Collect all log files: main + rotated (.1 through .5), newest first
$logFiles = @()
if (Test-Path $mainLog) { $logFiles += $mainLog }
for ($i = 1; $i -le 5; $i++) {
    $rotated = "$mainLog.$i"
    if (Test-Path $rotated) { $logFiles += $rotated }
}

if ($logFiles.Count -eq 0) {
    Write-Host "No log files found." -ForegroundColor Yellow
    Set-Content $artifact ""
    exit 0
}

# Grep for ERROR and WARNING lines
$matches = [System.Collections.Generic.List[string]]::new()
$seen    = [System.Collections.Generic.HashSet[string]]::new()

foreach ($file in $logFiles) {
    foreach ($line in (Get-Content $file -Encoding utf8)) {
        if ($line -match "\| ERROR\s+\|" -or $line -match "\| WARNING\s+\|") {
            # Dedupe key: module:line + message (strip timestamp so repeats collapse)
            $key = $line -replace "^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} \| ", ""
            if ($seen.Add($key)) {
                $matches.Add($line)
            }
        }
    }
}

# Also grab multi-line tracebacks that follow ERROR lines from the main log
if (Test-Path $mainLog) {
    $lines = Get-Content $mainLog -Encoding utf8
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match "\| ERROR\s+\|") {
            # Collect continuation lines (no timestamp prefix = part of traceback)
            $j = $i + 1
            while ($j -lt $lines.Count -and $lines[$j] -notmatch "^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} \|") {
                $tbLine = $lines[$j].Trim()
                if ($tbLine -ne "" -and $seen.Add("tb:$tbLine")) {
                    $matches.Add("  $($lines[$j])")
                }
                $j++
            }
        }
    }
}

if ($matches.Count -eq 0) {
    Write-Host "No errors or warnings found." -ForegroundColor Green
    Set-Content $artifact ""
    Write-Host ""
    Write-Host "  ==========================================" -ForegroundColor Green
    Write-Host "             LOG CLEAN                       " -ForegroundColor Green
    Write-Host "  ==========================================" -ForegroundColor Green
    Write-Host ""
    exit 0
}

# Write artifact
$matches | Set-Content $artifact -Encoding utf8

# Truncate the main log so next extraction only sees new entries
if (Test-Path $mainLog) {
    Clear-Content $mainLog
}

$errorCount   = @($matches | Where-Object { $_ -match "\| ERROR\s+\|" }).Count
$warningCount = @($matches | Where-Object { $_ -match "\| WARNING\s+\|" }).Count

Write-Host "  Errors   : $errorCount" -ForegroundColor Red
Write-Host "  Warnings : $warningCount" -ForegroundColor Yellow
Write-Host ""
Write-Host "Written to: $artifact" -ForegroundColor Cyan
Write-Host "Main log truncated." -ForegroundColor DarkGray
Write-Host ""
Write-Host "  ==========================================" -ForegroundColor Yellow
Write-Host "       ERRORS EXTRACTED -- run /fix-all log  " -ForegroundColor Yellow
Write-Host "  ==========================================" -ForegroundColor Yellow
Write-Host ""
exit 1
