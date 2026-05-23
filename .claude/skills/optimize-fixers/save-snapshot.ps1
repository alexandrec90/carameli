[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
Push-Location $repoRoot
try {
    $source = 'logs/agent/skills-profile.json'
    $dest   = 'logs/agent/skills-profile.optimized.json'

    if (-not (Test-Path -LiteralPath $source)) {
        exit 0
    }

    Copy-Item -LiteralPath $source -Destination $dest -Force
    exit 0
}
finally {
    Pop-Location
}
