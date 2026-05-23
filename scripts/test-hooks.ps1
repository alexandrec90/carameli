[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

function Assert-True {
    param(
        [Parameter(Mandatory = $true)]
        [bool]$Condition,
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$preToolScript = Join-Path $repoRoot 'scripts/hooks/copilot-settings-pretool.ps1'
$stopScript = Join-Path $repoRoot 'scripts/hooks/copilot-settings-stop.ps1'
$testMarker = Join-Path $repoRoot '.claude/skills/test-skill/.active'
$fixTestsMarker = Join-Path $repoRoot '.claude/skills/fix-tests-auto/.active'
$hookArtifact = Join-Path $repoRoot 'logs/agent/test-skill-hook.txt'

Push-Location $repoRoot
try {
    Remove-Item -LiteralPath $testMarker -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $fixTestsMarker -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $hookArtifact -Force -ErrorAction SilentlyContinue

    Write-Output '[1/3] PreToolUse no-marker no-op test'
    & pwsh -NoProfile -ExecutionPolicy Bypass -File $preToolScript
    Assert-True (-not (Test-Path -LiteralPath $hookArtifact)) 'PreToolUse created hook artifact without activation marker.'

    Write-Output '[2/3] PreToolUse marker-gated action test'
    New-Item -ItemType File -Path $testMarker -Force | Out-Null
    & pwsh -NoProfile -ExecutionPolicy Bypass -File $preToolScript
    Assert-True (Test-Path -LiteralPath $hookArtifact) 'PreToolUse did not create hook artifact with activation marker.'

    $line = (Get-Content -LiteralPath $hookArtifact -Raw).Trim()
    Assert-True ($line -like 'hello from frontmatter hook at *') 'Hook artifact content format was unexpected.'

    Write-Output '[3/3] Stop hook dry-run test'
    & pwsh -NoProfile -ExecutionPolicy Bypass -File $stopScript -DryRun | Out-Null
    Assert-True ($LASTEXITCODE -eq 0) ('Stop hook dry-run failed with exit code ' + $LASTEXITCODE)

    Write-Output ''
    Write-Output 'HOOK_TESTS=PASS'
    exit 0
}
catch {
    Write-Error ('HOOK_TESTS=FAIL ' + $_.Exception.Message)
    exit 1
}
finally {
    Remove-Item -LiteralPath $testMarker -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $fixTestsMarker -Force -ErrorAction SilentlyContinue
    Pop-Location
}
