[CmdletBinding()]
param()

$ErrorActionPreference = 'SilentlyContinue'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
Push-Location $repoRoot
try {
    $markerFile = Join-Path $PSScriptRoot '.migration-needed'

    # Check if any app/models/*.py file (other than __init__.py) is modified/untracked
    $changed = & git status --porcelain -- app/models/*.py 2>$null |
        Where-Object { $_ -and $_ -notmatch '__init__\.py' }

    if (-not $changed) {
        # Models are committed - clear the marker so next edit triggers a fresh reminder
        Remove-Item -LiteralPath $markerFile -Force -ErrorAction SilentlyContinue
        exit 0
    }

    # Already notified this session - skip
    if (Test-Path -LiteralPath $markerFile) { exit 0 }

    # First trigger: write marker and emit reminder
    Set-Content -LiteralPath $markerFile -Value (Get-Date -Format 'o') -Encoding utf8

    Write-Output ""
    Write-Output "MIGRATION NEEDED: app/models/ files have uncommitted changes."
    Write-Output "Once all model edits are complete, tell the user to run:"
    Write-Output "  docker compose exec -T app alembic revision --autogenerate -m `"<description>`""
    Write-Output "Then open the new file in alembic/versions/ and verify columns, FK behaviour,"
    Write-Output "indexes, and gen_random_uuid() defaults before applying with: alembic upgrade head"
    Write-Output ""
    exit 0
}
finally {
    Pop-Location
}
