[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string[]]$Roots,

    [Parameter(Mandatory = $true)]
    [string[]]$Includes,

    [string[]]$ExcludeDirs = @(),

    [string[]]$ExcludeNames = @(),

    [int]$Top = 0,

    [switch]$WithGitHash
)

$ErrorActionPreference = 'Stop'

# Normalize: a single comma-joined string (e.g. from -File invocation) becomes an array.
function Split-CommaArg {
    param([string[]]$Value)
    if ($Value.Count -eq 1 -and $Value[0] -match ',') {
        return ($Value[0] -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    }
    return $Value
}
$Roots        = Split-CommaArg $Roots
$Includes     = Split-CommaArg $Includes
$ExcludeDirs  = Split-CommaArg $ExcludeDirs
$ExcludeNames = Split-CommaArg $ExcludeNames

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
Push-Location $repoRoot
try {
    $excludeDirRegex = $null
    if ($ExcludeDirs.Count -gt 0) {
        $escaped = $ExcludeDirs | ForEach-Object { [regex]::Escape($_) }
        $excludeDirRegex = '(^|/)(' + ($escaped -join '|') + ')(/|$)'
    }

    $records = New-Object System.Collections.Generic.List[object]

    foreach ($root in $Roots) {
        if (-not (Test-Path -LiteralPath $root)) { continue }
        Get-ChildItem -LiteralPath $root -Recurse -File -Include $Includes -ErrorAction SilentlyContinue | ForEach-Object {
            $rel = $_.FullName.Substring($repoRoot.Length).TrimStart('\','/').Replace('\','/')

            if ($excludeDirRegex -and $rel -match $excludeDirRegex) { return }

            $skipByName = $false
            foreach ($pat in $ExcludeNames) {
                if ($_.Name -like $pat) { $skipByName = $true; break }
            }
            if ($skipByName) { return }

            $lineCount = 0
            try {
                $lineCount = (Get-Content -LiteralPath $_.FullName -ErrorAction SilentlyContinue | Measure-Object -Line).Lines
            } catch {}

            $records.Add([PSCustomObject]@{
                Path  = $rel
                Lines = $lineCount
            }) | Out-Null
        }
    }

    $sorted = $records | Sort-Object -Property Lines -Descending
    if ($Top -gt 0) {
        $sorted = $sorted | Select-Object -First $Top
    }

    if ($WithGitHash) {
        Write-Output ("lines`thash`tpath")
    } else {
        Write-Output ("lines`tpath")
    }

    foreach ($rec in $sorted) {
        if ($WithGitHash) {
            $hash = & git log --format='%H' -1 -- $rec.Path 2>$null
            if (-not $hash) { $hash = 'UNCOMMITTED' } else { $hash = $hash.Trim() }
            Write-Output ("{0}`t{1}`t{2}" -f $rec.Lines, $hash, $rec.Path)
        } else {
            Write-Output ("{0}`t{1}" -f $rec.Lines, $rec.Path)
        }
    }
    exit 0
}
finally {
    Pop-Location
}
