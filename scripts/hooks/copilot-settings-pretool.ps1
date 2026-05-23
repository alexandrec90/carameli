[CmdletBinding()]
param(
    [switch]$DryRun
)

$ErrorActionPreference = 'Continue'
$isDryRun = $DryRun -or ($env:CARAMELI_HOOK_DRY_RUN -eq '1')

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$fixTestsAutoMarker = Join-Path $repoRoot '.claude/skills/fix-tests-auto/.active'
$testSkillMarker = Join-Path $repoRoot '.claude/skills/test-skill/.active'

if (-not (Test-Path -LiteralPath $fixTestsAutoMarker) -and -not (Test-Path -LiteralPath $testSkillMarker)) {
    exit 0
}

if (Test-Path -LiteralPath $testSkillMarker) {
    if ($isDryRun) {
        Write-Output '[DRY RUN] test-skill marker found; would run write-artifacts.ps1 -Mode hook'
    }
    else {
    Push-Location $repoRoot
    try {
        & pwsh -NoProfile -ExecutionPolicy Bypass -File .claude/skills/test-skill/write-artifacts.ps1 -Mode hook | Out-Null
    }
    finally {
        Pop-Location
    }
    }
}

if (-not (Test-Path -LiteralPath $fixTestsAutoMarker)) {
    exit 0
}

Push-Location $repoRoot
try {
    if ($isDryRun) {
        Write-Output '[DRY RUN] fix-tests-auto marker found; would run restart-if-app-diff.ps1'
    }
    else {
        & pwsh -NoProfile -ExecutionPolicy Bypass -File .claude/skills/fix-tests-auto/restart-if-app-diff.ps1 | Out-Null
    }
    exit 0
}
finally {
    Pop-Location
}
