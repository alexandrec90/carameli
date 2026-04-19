# archive-done-todos.ps1
# Moves checked items (* [X] / * [x]) from active sections into ## Done.
param()
$ErrorActionPreference = 'Stop'

$file = Join-Path $PSScriptRoot ".." "todo.md"
if (-not (Test-Path $file)) {
    Write-Error "todo.md not found at $file"
    exit 1
}

$doneMarker = "## Done"
$lines = Get-Content $file

$doneIdx = -1
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -eq $doneMarker) { $doneIdx = $i; break }
}
if ($doneIdx -eq -1) {
    Write-Error "No '$doneMarker' section found in todo.md"
    exit 1
}

$activeLines = [System.Collections.Generic.List[string]]::new()
$doneLines = [System.Collections.Generic.List[string]]::new()
$moved = 0
$inDone = $false

foreach ($line in $lines) {
    if ($line -eq $doneMarker) { $inDone = $true; continue }
    if ($inDone) {
        $doneLines.Add($line)
    }
    elseif ($line -match '^\* \[[Xx]\]') {
        $doneLines.Add($line)
        $moved++
    }
    else {
        $activeLines.Add($line)
    }
}

# Trim trailing blank lines before the Done section
while ($activeLines.Count -gt 0 -and $activeLines[$activeLines.Count - 1].Trim() -eq '') {
    $activeLines.RemoveAt($activeLines.Count - 1)
}

$output = [System.Collections.Generic.List[string]]::new()
foreach ($l in $activeLines) { $output.Add($l) }
$output.Add("")
$output.Add($doneMarker)
foreach ($l in $doneLines) { $output.Add($l) }

Set-Content -Path $file -Value $output
Write-Host "Moved $moved checked item(s) to '$doneMarker'."
