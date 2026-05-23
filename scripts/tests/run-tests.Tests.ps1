Set-StrictMode -Version Latest

Describe 'run-tests.ps1' {
    BeforeAll {
        . (Join-Path $PSScriptRoot 'TestHelpers.ps1')
    }

    It 'clears artifact on successful test run' {
        $workspace = Join-Path ([System.IO.Path]::GetTempPath()) ('carameli-runtests-' + [guid]::NewGuid())
        New-Item -ItemType Directory -Path (Join-Path $workspace 'logs') -Force | Out-Null
        $binDir = New-FakeDockerHarness -Root $workspace

        $oldPath = $env:PATH
        $env:PATH = $binDir + ';' + $oldPath
        $env:CARAMELI_FAKE_DOCKER_SCENARIO = 'run-tests-pass'
        try {
            $result = Invoke-WorkspaceScript -Workspace $workspace -ScriptPath (Join-Path ((Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path) 'scripts/run-tests.ps1')
        }
        finally {
            $env:PATH = $oldPath
            Remove-Item Env:CARAMELI_FAKE_DOCKER_SCENARIO -ErrorAction SilentlyContinue
        }

        $result.ExitCode | Should -Be 0
        ((Get-Content -LiteralPath (Join-Path $workspace 'logs/test-failures.log') -Raw).Trim()) | Should -Be ''

        Remove-Item -LiteralPath $workspace -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'writes compact actionable artifact on failure and strips INFO noise' {
        $workspace = Join-Path ([System.IO.Path]::GetTempPath()) ('carameli-runtests-' + [guid]::NewGuid())
        New-Item -ItemType Directory -Path (Join-Path $workspace 'logs') -Force | Out-Null
        $binDir = New-FakeDockerHarness -Root $workspace

        $oldPath = $env:PATH
        $env:PATH = $binDir + ';' + $oldPath
        $env:CARAMELI_FAKE_DOCKER_SCENARIO = 'run-tests-fail'
        try {
            $result = Invoke-WorkspaceScript -Workspace $workspace -ScriptPath (Join-Path ((Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path) 'scripts/run-tests.ps1')
        }
        finally {
            $env:PATH = $oldPath
            Remove-Item Env:CARAMELI_FAKE_DOCKER_SCENARIO -ErrorAction SilentlyContinue
        }

        $result.ExitCode | Should -Be 1
        $artifact = Get-Content -LiteralPath (Join-Path $workspace 'logs/test-failures.log') -Raw
        $artifact | Should -Match 'FAILED tests/unit/test_bad.py::test_one - AssertionError: nope'
        $artifact | Should -Match 'E   AssertionError: nope'
        $artifact | Should -Match 'ERROR app.foo:bar.py:13 useful failure context'
        $artifact | Should -Not -Match 'INFO app.foo:bar.py:12 fixture noise'

        Remove-Item -LiteralPath $workspace -Recurse -Force -ErrorAction SilentlyContinue
    }
}
