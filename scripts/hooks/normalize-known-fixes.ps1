[CmdletBinding()]
param(
    [int]$StaleDays = 90,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Split-MarkdownCells {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Row
    )

    $trimmed = $Row.Trim()
    if ($trimmed.StartsWith('|')) {
        $trimmed = $trimmed.Substring(1)
    }
    if ($trimmed.EndsWith('|')) {
        $trimmed = $trimmed.Substring(0, $trimmed.Length - 1)
    }

    $cells = [System.Collections.Generic.List[string]]::new()
    $current = [System.Text.StringBuilder]::new()
    $escape = $false

    foreach ($char in $trimmed.ToCharArray()) {
        if ($escape) {
            [void]$current.Append($char)
            $escape = $false
            continue
        }

        if ($char -eq '\\') {
            [void]$current.Append($char)
            $escape = $true
            continue
        }

        if ($char -eq '|') {
            $cells.Add($current.ToString().Trim())
            [void]$current.Clear()
            continue
        }

        [void]$current.Append($char)
    }

    $cells.Add($current.ToString().Trim())
    return ,$cells
}

function Parse-IntSafe {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    $out = 0
    if ([int]::TryParse($Value.Trim(), [ref]$out)) {
        return $out
    }

    return $null
}

function Parse-DateSafe {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Value
    )

    $text = $Value.Trim()
    if ([string]::IsNullOrWhiteSpace($text) -or $text -eq '--' -or $text -eq '-') {
        return $null
    }

    $dt = [DateTime]::MinValue
    $ok = [DateTime]::TryParseExact(
        $text,
        'yyyy-MM-dd',
        [System.Globalization.CultureInfo]::InvariantCulture,
        [System.Globalization.DateTimeStyles]::AssumeUniversal,
        [ref]$dt
    )

    if ($ok) {
        return $dt.Date
    }

    return $null
}

function Normalize-KnownFixesFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [int]$StaleDays = 90,
        [switch]$DryRun
    )

    $raw = Get-Content -LiteralPath $FilePath -Raw
    if ([string]::IsNullOrEmpty($raw)) {
        return [pscustomobject]@{
            File = $FilePath
            Changed = $false
            Pruned = 0
            Rows = 0
        }
    }

    $lines = @($raw -split "`r?`n")
    $headerPattern = '^\|\s*Error pattern \(substring\)\s*\|\s*Root cause\s*\|\s*Fix\s*\|\s*Hits\s*\|\s*Last used\s*\|\s*Added\s*\|\s*$'

    $headerIndex = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match $headerPattern) {
            $headerIndex = $i
            break
        }
    }

    if ($headerIndex -lt 0) {
        return [pscustomobject]@{
            File = $FilePath
            Changed = $false
            Pruned = 0
            Rows = 0
        }
    }

    $separatorIndex = $headerIndex + 1
    if ($separatorIndex -ge $lines.Count) {
        return [pscustomobject]@{
            File = $FilePath
            Changed = $false
            Pruned = 0
            Rows = 0
        }
    }

    $rowStart = $separatorIndex + 1
    $rowEndExclusive = $rowStart
    while ($rowEndExclusive -lt $lines.Count) {
        $line = $lines[$rowEndExclusive]
        if ($line.TrimStart().StartsWith('|')) {
            $rowEndExclusive++
            continue
        }

        break
    }

    $today = (Get-Date).Date
    $normalizedRows = [System.Collections.Generic.List[string]]::new()
    $pruned = 0

    for ($r = $rowStart; $r -lt $rowEndExclusive; $r++) {
        $line = $lines[$r].Trim()
        if ([string]::IsNullOrWhiteSpace($line)) {
            continue
        }

        if ($line -match '^\|\s*:?-{3,}:?\s*\|') {
            continue
        }

        $cells = Split-MarkdownCells -Row $line
        $normalizedCells = [System.Collections.Generic.List[string]]::new()
        foreach ($c in $cells) {
            $normalizedCells.Add($c.Trim())
        }

        while ($normalizedCells.Count -lt 6) {
            $normalizedCells.Add('')
        }
        if ($normalizedCells.Count -gt 6) {
            $fixParts = $normalizedCells.GetRange(2, $normalizedCells.Count - 4)
            $fixCell = ($fixParts -join ' | ').Trim()
            $hitsCell = $normalizedCells[$normalizedCells.Count - 3]
            $lastUsedCell = $normalizedCells[$normalizedCells.Count - 2]
            $addedCell = $normalizedCells[$normalizedCells.Count - 1]

            $normalizedCells = [System.Collections.Generic.List[string]]::new()
            $normalizedCells.Add($cells[0].Trim())
            $normalizedCells.Add($cells[1].Trim())
            $normalizedCells.Add($fixCell)
            $normalizedCells.Add($hitsCell.Trim())
            $normalizedCells.Add($lastUsedCell.Trim())
            $normalizedCells.Add($addedCell.Trim())
        }

        $hits = Parse-IntSafe -Value $normalizedCells[3]
        $addedDate = Parse-DateSafe -Value $normalizedCells[5]
        if ($null -ne $hits -and $hits -eq 0 -and $null -ne $addedDate) {
            $ageDays = ($today - $addedDate).Days
            if ($ageDays -gt $StaleDays) {
                $pruned++
                continue
            }
        }

        $normalizedRows.Add('| ' + ($normalizedCells -join ' | ') + ' |')
    }

    $prefix = @()
    if ($headerIndex -gt 0) {
        $prefix = $lines[0..($headerIndex - 1)]
    }

    $suffix = @()
    if ($rowEndExclusive -lt $lines.Count) {
        $suffix = $lines[$rowEndExclusive..($lines.Count - 1)]
    }

    $newLines = @()
    $newLines += $prefix
    $newLines += '| Error pattern (substring) | Root cause | Fix | Hits | Last used | Added |'
    $newLines += '|---|---|---|---|---|---|'
    $newLines += $normalizedRows
    $newLines += $suffix

    $newContent = ($newLines -join "`n")
    if ($raw.EndsWith("`r`n")) {
        $newContent = $newContent.Replace("`n", "`r`n")
    }

    $changed = ($newContent -ne $raw)
    if ($changed -and -not $DryRun) {
        Set-Content -LiteralPath $FilePath -Value $newContent -Encoding utf8
    }

    return [pscustomobject]@{
        File = $FilePath
        Changed = $changed
        Pruned = $pruned
        Rows = $normalizedRows.Count
    }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$skillsRoot = Join-Path $repoRoot '.claude/skills'
if (-not (Test-Path -LiteralPath $skillsRoot)) {
    Write-Output 'normalize-known-fixes: skills directory not found; skipping.'
    exit 0
}

$knownFixFiles = Get-ChildItem -LiteralPath $skillsRoot -Directory |
    ForEach-Object { Join-Path $_.FullName 'known-fixes.md' } |
    Where-Object { Test-Path -LiteralPath $_ }

if (-not $knownFixFiles) {
    Write-Output 'normalize-known-fixes: no known-fixes files found; skipping.'
    exit 0
}

$results = foreach ($file in $knownFixFiles) {
    Normalize-KnownFixesFile -FilePath $file -StaleDays $StaleDays -DryRun:$DryRun
}

$changedCount = @($results | Where-Object { $_.Changed }).Count
$prunedTotal = ($results | Measure-Object -Property Pruned -Sum).Sum
if ($null -eq $prunedTotal) {
    $prunedTotal = 0
}

if ($DryRun) {
    Write-Output ('[DRY RUN] normalize-known-fixes: scanned={0} changed={1} pruned={2}' -f $results.Count, $changedCount, $prunedTotal)
}
else {
    Write-Output ('normalize-known-fixes: scanned={0} changed={1} pruned={2}' -f $results.Count, $changedCount, $prunedTotal)
}

exit 0