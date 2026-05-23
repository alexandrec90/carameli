[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Command,
    [int]$MaxBytes = 4000,
    [int]$HeadBytes = 2000,
    [switch]$TailOnTruncate = $true
)

$ErrorActionPreference = 'Stop'

if ($MaxBytes -lt 512) {
    throw 'MaxBytes must be >= 512.'
}

if ($HeadBytes -lt 0) {
    throw 'HeadBytes must be >= 0.'
}

if ($HeadBytes -gt $MaxBytes) {
    $HeadBytes = $MaxBytes
}

$stderrPath = [System.IO.Path]::GetTempFileName()
try {
    $stdout = & pwsh -NoProfile -ExecutionPolicy Bypass -Command $Command 2> $stderrPath | Out-String
    $exitCode = $LASTEXITCODE
    $stderr = ''
    if (Test-Path -LiteralPath $stderrPath) {
        $stderr = Get-Content -LiteralPath $stderrPath -Raw
    }

    $combined = $stdout + $stderr
    if ([string]::IsNullOrEmpty($combined)) {
        exit $exitCode
    }

    $bytes = [System.Text.Encoding]::UTF8.GetBytes($combined)
    if ($bytes.Length -le $MaxBytes) {
        Write-Output $combined
        exit $exitCode
    }

    if (-not $TailOnTruncate) {
        $headOnly = [System.Text.Encoding]::UTF8.GetString($bytes, 0, $MaxBytes)
        Write-Output ($headOnly + "`n[truncated bytes=$($bytes.Length - $MaxBytes)]")
        exit $exitCode
    }

    $tailBytes = $MaxBytes - $HeadBytes
    if ($tailBytes -lt 0) {
        $tailBytes = 0
    }

    $head = ''
    if ($HeadBytes -gt 0) {
        $head = [System.Text.Encoding]::UTF8.GetString($bytes, 0, $HeadBytes)
    }

    $tail = ''
    if ($tailBytes -gt 0) {
        $tail = [System.Text.Encoding]::UTF8.GetString($bytes, $bytes.Length - $tailBytes, $tailBytes)
    }

    Write-Output ($head + "`n... [truncated bytes=$($bytes.Length - $MaxBytes)] ...`n" + $tail)
    exit $exitCode
}
finally {
    Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue
}
