[CmdletBinding()]
param(
    [switch]$InstallIfMissing,
    [string]$Path = 'scripts/tests'
)

$ErrorActionPreference = 'Stop'
$artifact = 'logs/pester-failures.log'
if (-not (Test-Path 'logs')) {
    New-Item -ItemType Directory -Path 'logs' | Out-Null
}

function Get-RelativeArtifactPath {
    param(
        [string]$FilePath
    )

    if ([string]::IsNullOrWhiteSpace($FilePath)) {
        return 'scripts/tests'
    }

    try {
        $resolvedRoot = (Resolve-Path '.').Path
        $resolvedFile = (Resolve-Path $FilePath -ErrorAction Stop).Path
        if ($resolvedFile.StartsWith($resolvedRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $resolvedFile.Substring($resolvedRoot.Length).TrimStart('\', '/')
        }
        return $resolvedFile
    }
    catch {
        return $FilePath
    }
}

function Write-PesterArtifact {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Result,
        [Parameter(Mandatory = $true)]
        [string]$ArtifactPath,
        [Parameter(Mandatory = $true)]
        [string]$TargetPath
    )

    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.Add('# pester')
    $lines.Add('# fix: pwsh -ExecutionPolicy Bypass -File scripts/run-pester.ps1 -InstallIfMissing')

    foreach ($failed in @($Result.Failed)) {
        $file = Get-RelativeArtifactPath $failed.ScriptBlock.File
        $line = if ($failed.StartLine) { [int]$failed.StartLine } else { 1 }
        $message = $failed.ErrorRecord.Exception.Message
        if ([string]::IsNullOrWhiteSpace($message)) {
            $message = 'Pester test failed.'
        }

        $lines.Add(($file + ':' + $line + ':1: [Pester] ' + $failed.ExpandedPath + ' -- ' + $message))

        foreach ($stdoutLine in @($failed.StandardOutput -split "`r?`n")) {
            if (-not [string]::IsNullOrWhiteSpace($stdoutLine)) {
                $lines.Add(('  stdout: ' + $stdoutLine.TrimEnd()))
            }
        }
    }

    if (@($Result.Failed).Count -eq 0) {
        $lines.Add(($TargetPath + ':1:1: [Pester] Pester reported a failure but returned no failed test details.'))
    }

    $lines.Add('')
    $lines | Set-Content -Path $ArtifactPath -Encoding utf8
}

function Get-PesterVersion {
    $module = Get-Module -ListAvailable -Name Pester | Sort-Object Version -Descending | Select-Object -First 1
    if ($null -eq $module) {
        return $null
    }
    return $module.Version
}

$requiredMajor = 5
$currentVersion = Get-PesterVersion

if ($null -eq $currentVersion -or $currentVersion.Major -lt $requiredMajor) {
    if (-not $InstallIfMissing) {
        Set-Content $artifact '' -Encoding utf8
        Write-Host 'Pester 5+ is required but not installed.' -ForegroundColor Red
        Write-Host 'Re-run with -InstallIfMissing or install manually:' -ForegroundColor Yellow
        Write-Host '  Install-Module Pester -Scope CurrentUser -Force -SkipPublisherCheck' -ForegroundColor DarkGray
        exit 1
    }

    Write-Host 'Installing Pester (CurrentUser scope)...' -ForegroundColor Yellow
    try {
        $repo = Get-PSRepository -Name PSGallery -ErrorAction SilentlyContinue
        if ($null -ne $repo -and $repo.InstallationPolicy -ne 'Trusted') {
            Set-PSRepository -Name PSGallery -InstallationPolicy Trusted
        }
    }
    catch {
        Write-Host 'Could not set PSGallery to Trusted; continuing.' -ForegroundColor DarkGray
    }

    Install-Module -Name Pester -Scope CurrentUser -Force -SkipPublisherCheck
    $currentVersion = Get-PesterVersion
    if ($null -eq $currentVersion -or $currentVersion.Major -lt $requiredMajor) {
        Set-Content $artifact '' -Encoding utf8
        Write-Host 'Failed to install Pester 5+.' -ForegroundColor Red
        exit 1
    }
}

Import-Module Pester -MinimumVersion 5.0.0 -Force

if (-not (Test-Path -LiteralPath $Path)) {
    Set-Content $artifact '' -Encoding utf8
    Write-Host ('Pester test path not found: ' + $Path) -ForegroundColor Red
    exit 1
}

$result = Invoke-Pester -Path $Path -Output Detailed -PassThru

if ($null -eq $result) {
    Set-Content $artifact '' -Encoding utf8
    Write-Host 'Pester returned no result.' -ForegroundColor Red
    exit 1
}

if ($result.FailedCount -gt 0) {
    Write-PesterArtifact -Result $result -ArtifactPath $artifact -TargetPath $Path
    Write-Host ('Failures written to: ' + $artifact) -ForegroundColor Red
    Write-Host ('Pester failed: ' + $result.FailedCount + ' test(s) failed.') -ForegroundColor Red
    exit 1
}

Set-Content $artifact '' -Encoding utf8
Write-Host ('Pester passed: ' + $result.PassedCount + ' test(s) passed.') -ForegroundColor Green
exit 0
