[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$markerPath = Join-Path $PSScriptRoot '.app-restart-hash'

Push-Location $repoRoot
try {
    $changed = git diff --name-only -- app 2>$null
    if ($LASTEXITCODE -ne 0) {
        exit 0
    }

    if (-not $changed -or $changed.Count -eq 0) {
        if (Test-Path $markerPath) {
            Remove-Item $markerPath -Force -ErrorAction SilentlyContinue
        }
        exit 0
    }

    $normalized = ($changed | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Sort-Object) -join "`n"

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($normalized)
        $currentHash = [System.BitConverter]::ToString($sha256.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $sha256.Dispose()
    }

    $previousHash = ''
    if (Test-Path $markerPath) {
        $previousHash = (Get-Content -Path $markerPath -Raw).Trim()
    }

    if ($previousHash -eq $currentHash) {
        exit 0
    }

    & pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/docker-restart-app.ps1 *> $null
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }

    Set-Content -Path $markerPath -Value $currentHash -Encoding utf8
    exit 0
}
finally {
    Pop-Location
}
