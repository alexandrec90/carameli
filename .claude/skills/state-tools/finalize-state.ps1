[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Skill,

    [Parameter(Mandatory = $true)]
    [ValidateSet('audit', 'modules', 'files')]
    [string]$Schema
)

$ErrorActionPreference = 'Stop'

$skillDir = Join-Path '.claude/skills' $Skill
if (-not (Test-Path $skillDir)) {
    [Environment]::Exit(0)
}

if ($Schema -eq 'audit') {
    $artifact = Join-Path $skillDir 'scan-results.json'
    $plan = Join-Path $skillDir 'scan-plan.json'
    if (-not (Test-Path $artifact) -or -not (Test-Path $plan)) {
        [Environment]::Exit(0)
    }
}
else {
    $artifact = Join-Path $skillDir 'state-updates.json'
    if (-not (Test-Path $artifact)) {
        [Environment]::Exit(0)
    }
}

& python .claude/skills/state-tools/state-engine.py apply --skill $Skill --schema $Schema
$applyExit = $LASTEXITCODE

if ($applyExit -eq 0) {
    Remove-Item $artifact -Force -ErrorAction SilentlyContinue
    if ($Schema -eq 'audit') {
        Remove-Item $plan -Force -ErrorAction SilentlyContinue
    }
}

[Environment]::Exit($applyExit)
