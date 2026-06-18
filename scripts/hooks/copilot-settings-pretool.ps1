[CmdletBinding()]
param(
    [switch]$DryRun
)

$ErrorActionPreference = 'Continue'
$isDryRun = $DryRun -or ($env:CARAMELI_HOOK_DRY_RUN -eq '1')

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$rawHookPayload = [Console]::In.ReadToEnd()

# Enforce audit-design-flaws Step 2.5 batch caps before any other pre-tool behavior.
if ($isDryRun) {
    Write-Output '[DRY RUN] would enforce audit-design-flaws Step 2.5 batch caps'
}
else {
    $enforceScript = Join-Path $repoRoot 'scripts/hooks/enforce-audit-batch-caps.ps1'
    if (Test-Path -LiteralPath $enforceScript) {
        $rawHookPayload | & pwsh -NoProfile -ExecutionPolicy Bypass -File $enforceScript
        if ($LASTEXITCODE -ne 0) {
            exit $LASTEXITCODE
        }
    }
}

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
