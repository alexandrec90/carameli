[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
Push-Location $repoRoot
try {
    function Format-Match {
        param($Match)
        $rel = ($Match.Path.Substring($repoRoot.Length).TrimStart('\','/')) -replace '\\', '/'
        "${rel}:$($Match.LineNumber):$($Match.Line.Trim())"
    }

    Write-Output "=== Check 1: Credential fields in response schemas ==="
    if (Test-Path 'app/schemas') {
        Get-ChildItem -LiteralPath 'app/schemas' -Recurse -File -Filter '*.py' -ErrorAction SilentlyContinue |
            Select-String -Pattern '^\s+(api_key|password|secret|token)\s*:' |
            ForEach-Object { Format-Match $_ }
    }
    else {
        Write-Output "[app/schemas not found]"
    }
    Write-Output ""

    Write-Output "=== Check 2: Raw env var access for credentials (excluding app/core/config.py) ==="
    Get-ChildItem -LiteralPath 'app' -Recurse -File -Filter '*.py' -ErrorAction SilentlyContinue |
        Where-Object {
            $rel = ($_.FullName.Substring($repoRoot.Length).TrimStart('\','/')) -replace '\\', '/'
            $rel -ne 'app/core/config.py'
        } |
        Select-String -Pattern 'os\.(environ\.get|getenv)\(["\x27].*?(key|secret|password|token).*?["\x27]' |
        ForEach-Object { Format-Match $_ }
    Write-Output ""

    exit 0
}
finally {
    Pop-Location
}
