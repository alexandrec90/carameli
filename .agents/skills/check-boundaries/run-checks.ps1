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

    Write-Output "=== Check 1: Provider boundary leak ==="
    Get-ChildItem -LiteralPath 'app' -Recurse -File -Filter '*.py' -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '[\\/]app[\\/]services[\\/]providers[\\/]' } |
        Select-String -Pattern '^\s*(import telnyx|from telnyx|import jambonz|from jambonz)' |
        ForEach-Object { Format-Match $_ }
    Write-Output ""

    Write-Output "=== Check 2: Layer boundary violation ==="
    Get-ChildItem -LiteralPath 'app/api' -Recurse -File -Filter '*.py' -ErrorAction SilentlyContinue |
        Select-String -Pattern 'from app\.repositories\.' |
        ForEach-Object { Format-Match $_ }
    Write-Output ""

    Write-Output "=== Check 3: Blocking I/O in async modules ==="
    Get-ChildItem -LiteralPath 'app' -Recurse -File -Filter '*.py' -ErrorAction SilentlyContinue |
        Select-String -Pattern '^\s*(import requests|from requests|import urllib\.request|import time$|from time import sleep|import subprocess|from subprocess)' |
        ForEach-Object { Format-Match $_ }
    Write-Output ""

    exit 0
}
finally {
    Pop-Location
}
