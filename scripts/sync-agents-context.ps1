#Requires -Version 7
<#
.SYNOPSIS
    Syncs CLAUDE.md -> AGENTS.md (all subdirs) and .claude/ -> .agents/.
    CLAUDE.md / .claude/ are the source of truth; run this after editing them.
#>
param(
    [string]$Root = $PSScriptRoot ? (Split-Path $PSScriptRoot -Parent) : (Get-Location).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$copied  = 0
$skipped = 0

# --- 1. Copy every CLAUDE.md -> AGENTS.md in the same directory --------------
$claudeFiles = Get-ChildItem -Path $Root -Filter 'CLAUDE.md' -Recurse -File

foreach ($src in $claudeFiles) {
    $dest = Join-Path $src.DirectoryName 'AGENTS.md'
    Copy-Item -Path $src.FullName -Destination $dest -Force
    Write-Host "  copied  $($src.FullName -replace [regex]::Escape($Root), '.')"
    $copied++
}

# --- 2. Mirror .claude/ -> .agents/ ------------------------------------------
$claudeDir = Join-Path $Root '.claude'
$agentsDir = Join-Path $Root '.agents'

if (Test-Path $claudeDir) {
    # robocopy: /MIR mirrors (copies new/changed, removes orphans)
    # /NJH /NJS /NP suppress header/summary/progress noise
    # Exit codes 0-7 are success for robocopy
    $rc = robocopy $claudeDir $agentsDir /MIR /NJH /NJS /NP /NFL /NDL 2>&1
    $ec = $LASTEXITCODE
    if ($ec -le 7) {
        Write-Host "  mirrored .claude/ -> .agents/"
        $copied++
    } else {
        Write-Error "robocopy failed (exit $ec): $rc"
        exit 1
    }
} else {
    Write-Host "  skipped  .claude/ (not found)"
    $skipped++
}

Write-Host ""
Write-Host "Done. $copied item(s) synced, $skipped skipped."
exit 0
