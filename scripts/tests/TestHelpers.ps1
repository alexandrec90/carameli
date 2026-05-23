Set-StrictMode -Version Latest

function Invoke-WorkspaceScript {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Workspace,
        [Parameter(Mandatory = $true)]
        [string]$ScriptPath,
        [string[]]$Arguments = @()
    )

    Push-Location $Workspace
    try {
        $output = & pwsh -NoProfile -ExecutionPolicy Bypass -File $ScriptPath @Arguments 2>&1
        return @{
            Output = @($output | ForEach-Object { "$_" })
            ExitCode = $LASTEXITCODE
        }
    }
    finally {
        Pop-Location
    }
}

function New-FakeDockerHarness {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root
    )

    $binDir = Join-Path $Root 'fake-bin'
    New-Item -ItemType Directory -Path $binDir -Force | Out-Null

    $cmdPath = Join-Path $binDir 'docker.cmd'
    $ps1Path = Join-Path $binDir 'fake-docker.ps1'

    @'
@echo off
pwsh -NoProfile -ExecutionPolicy Bypass -File "%~dp0fake-docker.ps1" %*
exit /b %ERRORLEVEL%
'@ | Set-Content -LiteralPath $cmdPath -Encoding ascii

    @'
$ErrorActionPreference = 'Stop'
$joined = $args -join ' '
$scenario = $env:CARAMELI_FAKE_DOCKER_SCENARIO
$project = Split-Path -Leaf (Get-Location)

switch ($scenario) {
    'run-tests-pass' {
        Write-Output 'tests/unit/test_ok.py::test_one PASSED'
        exit 0
    }
    'run-tests-fail' {
        Write-Output 'tests/unit/test_bad.py::test_one FAILED'
        Write-Output '=================================== FAILURES ==================================='
        Write-Output '___________________________________ test_one ___________________________________'
        Write-Output 'tests/unit/test_bad.py:10: in test_one'
        Write-Output '    assert 1 == 2'
        Write-Output 'E   AssertionError: nope'
        Write-Output '----------------------------- Captured log call -----------------------------'
        Write-Output 'INFO app.foo:bar.py:12 fixture noise'
        Write-Output 'ERROR app.foo:bar.py:13 useful failure context'
        Write-Output '=========================== short test summary info ==========================='
        Write-Output 'FAILED tests/unit/test_bad.py::test_one - AssertionError: nope'
        Write-Output '========================= 1 failed, 0 passed in 0.12s ========================='
        exit 1
    }
    'docker-status-healthy' {
        if ($joined -like '*compose config --quiet*') {
            exit 0
        }
        if ($joined -like '*system df*') {
            Write-Output 'TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE'
            exit 0
        }
        if ($joined -like '*ps -a*table*') {
            Write-Output 'NAMES STATUS PORTS'
            Write-Output ($project + '-app-1 Up 2 minutes 0.0.0.0:8000->8000/tcp')
            exit 0
        }
        if ($joined -like '*ps -a*{{.Names}}|{{.Status}}*') {
            Write-Output ($project + '-app-1|Up 2 minutes')
            exit 0
        }
        if ($joined -like '*ps --filter*label=com.docker.compose.service=app*{{.Status}}*') {
            Write-Output 'Up 2 minutes'
            exit 0
        }
        if ($joined -like '*logs *app-1*') {
            Write-Output 'app container healthy log line'
            exit 0
        }
        if ($joined -like '*ps -q*') {
            Write-Output 'container123'
            exit 0
        }
        if ($joined -like '*inspect --format*') {
            Write-Output '{"Status":"healthy"}'
            exit 0
        }
        Write-Output ('UNHANDLED: ' + $joined)
        exit 0
    }
    'docker-status-unhealthy' {
        if ($joined -like '*compose config --quiet*') {
            exit 0
        }
        if ($joined -like '*system df*') {
            Write-Output 'TYPE            TOTAL     ACTIVE    SIZE      RECLAIMABLE'
            exit 0
        }
        if ($joined -like '*ps -a*table*') {
            Write-Output 'NAMES STATUS PORTS'
            Write-Output ($project + '-app-1 Up 2 minutes (healthy) 0.0.0.0:8000->8000/tcp')
            Write-Output ($project + '-db-1 Restarting (1) 8 seconds ago 5432/tcp')
            exit 0
        }
        if ($joined -like '*ps -a*{{.Names}}|{{.Status}}*') {
            Write-Output ($project + '-app-1|Up 2 minutes (healthy)')
            Write-Output ($project + '-db-1|Restarting (1) 8 seconds ago')
            exit 0
        }
        if ($joined -like '*logs *db-1*') {
            Write-Output 'db restart loop log line'
            exit 0
        }
        if ($joined -like '*logs *app-1*') {
            Write-Output 'app tail log line'
            exit 0
        }
        if ($joined -like '*ps -q*label=com.docker.compose.service=db*') {
            Write-Output 'db123'
            exit 0
        }
        if ($joined -like '*ps --filter*label=com.docker.compose.service=app*{{.Status}}*') {
            Write-Output 'Up 2 minutes'
            exit 0
        }
        if ($joined -like '*inspect --format*db123*') {
            Write-Output '{"Status":"unhealthy","Log":[{"Output":"db failed healthcheck"}]}'
            exit 0
        }
        Write-Output ('UNHANDLED: ' + $joined)
        exit 0
    }
    default {
        Write-Error ('Unknown fake docker scenario: ' + $scenario)
        exit 1
    }
}
'@ | Set-Content -LiteralPath $ps1Path -Encoding utf8

    return $binDir
}

function New-FakePesterModuleHarness {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root
    )

    $moduleRoot = Join-Path $Root 'fake-modules\Pester\5.5.0'
    New-Item -ItemType Directory -Path $moduleRoot -Force | Out-Null

    $manifestPath = Join-Path $moduleRoot 'Pester.psd1'
    $modulePath = Join-Path $moduleRoot 'Pester.psm1'

    @"
@{
    RootModule = 'Pester.psm1'
    ModuleVersion = '5.5.0'
    GUID = '4d8cbb3c-b744-4dc8-9840-2fc6900e8b7d'
    FunctionsToExport = @('Invoke-Pester')
}
"@ | Set-Content -LiteralPath $manifestPath -Encoding utf8

    @'
function Invoke-Pester {
    param(
        [string]$Path,
        [string]$Output,
        [switch]$PassThru
    )

    $scenario = $env:CARAMELI_FAKE_PESTER_SCENARIO
    $testFile = Join-Path (Get-Location) 'scripts/tests/fake-sample.Tests.ps1'

    switch ($scenario) {
        'pass' {
            return [pscustomobject]@{
                FailedCount = 0
                PassedCount = 2
                Failed = @()
            }
        }
        'fail' {
            $errorRecord = [System.Management.Automation.ErrorRecord]::new(
                [System.Exception]::new('Expected 2, but got 1.'),
                'PesterAssertionFailed',
                [System.Management.Automation.ErrorCategory]::InvalidResult,
                $null
            )

            $failedTest = [pscustomobject]@{
                ExpandedPath = 'demo.fails usefully'
                StartLine = 2
                StandardOutput = "captured useful line`nsecond useful line"
                ErrorRecord = $errorRecord
                ScriptBlock = [pscustomobject]@{
                    File = $testFile
                }
            }

            return [pscustomobject]@{
                FailedCount = 1
                PassedCount = 0
                Failed = @($failedTest)
            }
        }
        default {
            throw ('Unknown fake Pester scenario: ' + $scenario)
        }
    }
}
'@ | Set-Content -LiteralPath $modulePath -Encoding utf8

    return (Join-Path $Root 'fake-modules')
}
