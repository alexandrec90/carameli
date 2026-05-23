[CmdletBinding()]
param(
    [switch]$DryRun
)

$ErrorActionPreference = 'Continue'
$isDryRun = $DryRun -or ($env:CARAMELI_HOOK_DRY_RUN -eq '1')

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Push-Location $repoRoot
try {
    if ($isDryRun) {
        Write-Output '[DRY RUN] would finalize audit-design-flaws, make-tests, make-frontend-tests, refactor state artifacts'
        Write-Output '[DRY RUN] would save optimize-fixers snapshot when logs/agent/skills-profile.json exists'
        Write-Output '[DRY RUN] would normalize .claude/skills/*/known-fixes.md tables and prune stale zero-hit rows'
        Write-Output '[DRY RUN] would run frontend typecheck when frontend/src/skins has changes'
        exit 0
    }

    # State-driven skills: safe to call every stop; script exits 0 when artifacts are missing.
    & pwsh -NoProfile -ExecutionPolicy Bypass -File .claude/skills/state-tools/finalize-state.ps1 -Skill audit-design-flaws -Schema audit | Out-Null
    & pwsh -NoProfile -ExecutionPolicy Bypass -File .claude/skills/state-tools/finalize-state.ps1 -Skill make-tests -Schema modules | Out-Null
    & pwsh -NoProfile -ExecutionPolicy Bypass -File .claude/skills/state-tools/finalize-state.ps1 -Skill make-frontend-tests -Schema modules | Out-Null
    & pwsh -NoProfile -ExecutionPolicy Bypass -File .claude/skills/state-tools/finalize-state.ps1 -Skill refactor -Schema files | Out-Null

    # optimize-fixers snapshot: only when a profile exists.
    if (Test-Path -LiteralPath 'logs/agent/skills-profile.json') {
        & pwsh -NoProfile -ExecutionPolicy Bypass -File .claude/skills/optimize-fixers/save-snapshot.ps1 | Out-Null
    }

    # Normalize known-fixes tables and prune stale zero-hit rows.
    & pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/hooks/normalize-known-fixes.ps1 | Out-Null

    # add-skin parity: typecheck when skin files are modified.
    $skinChanged = & git status --porcelain -- frontend/src/skins 2>$null
    if ($skinChanged) {
        Push-Location frontend
        try {
            & npm run typecheck | Out-Null
        }
        finally {
            Pop-Location
        }
    }

    exit 0
}
finally {
    Pop-Location
}
