Set-StrictMode -Version Latest

Describe 'run-pester.ps1' {
    BeforeAll {
        . (Join-Path $PSScriptRoot 'TestHelpers.ps1')
        $script:runner = (Join-Path ((Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path) 'scripts/run-pester.ps1')
    }

    It 'clears artifact on successful pester run' {
        $workspace = Join-Path ([System.IO.Path]::GetTempPath()) ('carameli-runpester-' + [guid]::NewGuid())
        New-Item -ItemType Directory -Path (Join-Path $workspace 'logs') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $workspace 'scripts/tests') -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $workspace 'logs/pester-failures.log') -Value 'stale failure' -Encoding utf8
        Set-Content -LiteralPath (Join-Path $workspace 'scripts/tests/fake-sample.Tests.ps1') -Value "Describe 'fake' {}" -Encoding utf8

        $moduleRoot = New-FakePesterModuleHarness -Root $workspace
        $oldModulePath = $env:PSModulePath
        $env:PSModulePath = $moduleRoot + ';' + $oldModulePath
        $env:CARAMELI_FAKE_PESTER_SCENARIO = 'pass'
        try {
            $result = Invoke-WorkspaceScript -Workspace $workspace -ScriptPath $script:runner
        }
        finally {
            $env:PSModulePath = $oldModulePath
            Remove-Item Env:CARAMELI_FAKE_PESTER_SCENARIO -ErrorAction SilentlyContinue
        }

        $result.ExitCode | Should -Be 0
        ((Get-Content -LiteralPath (Join-Path $workspace 'logs/pester-failures.log') -Raw).Trim()) | Should -Be ''

        Remove-Item -LiteralPath $workspace -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'writes actionable artifact on pester failure' {
        $workspace = Join-Path ([System.IO.Path]::GetTempPath()) ('carameli-runpester-' + [guid]::NewGuid())
        New-Item -ItemType Directory -Path (Join-Path $workspace 'logs') -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $workspace 'scripts/tests') -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $workspace 'scripts/tests/fake-sample.Tests.ps1') -Value "Describe 'fake' {}" -Encoding utf8

        $moduleRoot = New-FakePesterModuleHarness -Root $workspace
        $oldModulePath = $env:PSModulePath
        $env:PSModulePath = $moduleRoot + ';' + $oldModulePath
        $env:CARAMELI_FAKE_PESTER_SCENARIO = 'fail'
        try {
            $result = Invoke-WorkspaceScript -Workspace $workspace -ScriptPath $script:runner
        }
        finally {
            $env:PSModulePath = $oldModulePath
            Remove-Item Env:CARAMELI_FAKE_PESTER_SCENARIO -ErrorAction SilentlyContinue
        }

        $result.ExitCode | Should -Be 1
        $artifact = Get-Content -LiteralPath (Join-Path $workspace 'logs/pester-failures.log') -Raw
        $artifact | Should -Match '# pester'
        $artifact | Should -Match '# fix: pwsh -ExecutionPolicy Bypass -File scripts/run-pester.ps1 -InstallIfMissing'
        $artifact | Should -Match 'scripts[\\/]tests[\\/]fake-sample.Tests.ps1:2:1: \[Pester\] demo.fails usefully -- Expected 2, but got 1\.'
        $artifact | Should -Match 'stdout: captured useful line'
        $artifact | Should -Match 'stdout: second useful line'

        Remove-Item -LiteralPath $workspace -Recurse -Force -ErrorAction SilentlyContinue
    }
}