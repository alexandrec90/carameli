# Extracts ERROR and WARNING lines from carameli.log (+ rotated backups),
# deduplicates by message, and writes the most recent $windowDays of entries
# to logs/log-errors.log. Log files are never modified.
$ErrorActionPreference = "Continue"

$windowDays = 3   # keep entries within this many days of the latest timestamp found

$logDir = "logs"
$runtimeDir = "$logDir/runtime"
$mainLog = "$runtimeDir/carameli.log"
$artifact = "$logDir/log-errors.log"

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

# Single pass per file: collect ERROR/WARNING entries (log line + filtered traceback) as groups.
# Tracebacks are filtered: first-party app/ frames kept, third-party frames skipped.
# Each entry is a hashtable { Timestamp; Lines } so we can sort chronologically at the end.
$entries = [System.Collections.Generic.List[hashtable]]::new()
$seen = [System.Collections.Generic.HashSet[string]]::new()

foreach ($file in $logFiles) {
    $lines = Get-Content $file -Encoding utf8
    $i = 0
    while ($i -lt $lines.Count) {
        $line = $lines[$i]
        $isError = $line -match "\| ERROR\s+\|"
        $isWarning = $line -match "\| WARNING\s+\|"

        if ($isError -or $isWarning) {
            # Extract timestamp for later sort (format is lexicographically sortable)
            $ts = if ($line -match "^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})") { $Matches[1] } else { "" }

            # Dedupe key: strip timestamp so identical messages from different times collapse
            $key = $line -replace "^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} \| ", ""
            $added = $seen.Add($key)

            # Collect raw traceback continuation lines (lines with no timestamp prefix)
            $rawTb = [System.Collections.Generic.List[string]]::new()
            $j = $i + 1
            while ($j -lt $lines.Count -and $lines[$j] -notmatch "^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} \|") {
                $rawTb.Add($lines[$j])
                $j++
            }
            $i = $j  # advance outer loop past the traceback block

            if ($added) {
                $entryLines = [System.Collections.Generic.List[string]]::new()
                $entryLines.Add($line)

                # Attach filtered traceback inline with its parent ERROR line
                if ($isError -and $rawTb.Count -gt 0) {
                    $k = 0
                    while ($k -lt $rawTb.Count) {
                        $tbLine = $rawTb[$k]
                        # Traceback header
                        if ($tbLine -match "^\s*Traceback \(most recent call last\)") {
                            $entryLines.Add("  $tbLine")
                            $k++; continue
                        }
                        # First-party File frame -- keep frame + its code line
                        if ($tbLine -match '^\s+File ".*[/\\]app[/\\]') {
                            $entryLines.Add("  $tbLine")
                            $k++
                            if ($k -lt $rawTb.Count -and $rawTb[$k] -notmatch '^\s+File ') {
                                $codeLine = $rawTb[$k].Trim()
                                if ($codeLine -ne "") { $entryLines.Add("  $($rawTb[$k])") }
                                $k++
                            }
                            continue
                        }
                        # Third-party File frame -- skip frame + its code line
                        if ($tbLine -match '^\s+File ') {
                            $k++
                            if ($k -lt $rawTb.Count -and $rawTb[$k] -notmatch '^\s+File ') { $k++ }
                            continue
                        }
                        # Final exception line (e.g. "sqlalchemy.exc.OperationalError: ...")
                        if ($tbLine -match '^[A-Za-z][\w.]*[\s:(]') {
                            $entryLines.Add("  $tbLine")
                            $k++; continue
                        }
                        $k++
                    }
                }

                $entries.Add(@{ Timestamp = $ts; Lines = $entryLines })
            }
        }
        else {
            $i++
        }
    }
}

# Filter to the last $windowDays of available data (relative to latest timestamp, not today)
if ($entries.Count -gt 0) {
    $latestTs = $entries |
        ForEach-Object { $_['Timestamp'] } |
        Where-Object { $_ -ne "" } |
        Sort-Object |
        Select-Object -Last 1
    if ($latestTs) {
        $latestDate = [datetime]::ParseExact($latestTs, "yyyy-MM-dd HH:mm:ss.fff", $null)
        $cutoff = $latestDate.AddDays(-$windowDays)
        $entries = @($entries | Where-Object {
            $ts = $_['Timestamp']
            if ($ts -eq "") { return $true }
            ([datetime]::ParseExact($ts, "yyyy-MM-dd HH:mm:ss.fff", $null)) -ge $cutoff
        })
        Write-Host "Date window : $($cutoff.ToString('yyyy-MM-dd')) to $($latestDate.ToString('yyyy-MM-dd')) ($windowDays days)" -ForegroundColor DarkGray
        Write-Host ""
    }
}

# Sort entries chronologically, then flatten to a line list for output
$logMatches = [System.Collections.Generic.List[string]]::new()
foreach ($entry in ($entries | Sort-Object { $_['Timestamp'] })) {
    foreach ($l in $entry['Lines']) { $logMatches.Add($l) }
}

if ($logMatches.Count -eq 0) {
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
$logMatches | Set-Content $artifact -Encoding utf8

$errorCount = @($logMatches | Where-Object { $_ -match "\| ERROR\s+\|" }).Count
$warningCount = @($logMatches | Where-Object { $_ -match "\| WARNING\s+\|" }).Count

Write-Host "  Errors   : $errorCount" -ForegroundColor Red
Write-Host "  Warnings : $warningCount" -ForegroundColor Yellow
Write-Host ""
Write-Host "Written to: $artifact" -ForegroundColor Cyan
Write-Host ""
Write-Host "  ==========================================" -ForegroundColor Yellow
Write-Host "       ERRORS EXTRACTED -- run /fix-logs  " -ForegroundColor Yellow
Write-Host "  ==========================================" -ForegroundColor Yellow
Write-Host ""
exit 1
