Set-StrictMode -Version Latest

Describe 'docker-status.ps1' {
    BeforeAll {
        . (Join-Path $PSScriptRoot 'TestHelpers.ps1')
    }

    It 'writes all-clear diagnostics when containers are healthy' {
        $workspace = Join-Path ([System.IO.Path]::GetTempPath()) ('carameli-dockerstatus-' + [guid]::NewGuid())
        New-Item -ItemType Directory -Path $workspace -Force | Out-Null
        $binDir = New-FakeDockerHarness -Root $workspace

        $oldPath = $env:PATH
        $env:PATH = $binDir + ';' + $oldPath
        $env:CARAMELI_FAKE_DOCKER_SCENARIO = 'docker-status-healthy'
        try {
            $result = Invoke-WorkspaceScript -Workspace $workspace -ScriptPath (Join-Path ((Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path) 'scripts/docker-status.ps1')
        }
        finally {
            $env:PATH = $oldPath
            Remove-Item Env:CARAMELI_FAKE_DOCKER_SCENARIO -ErrorAction SilentlyContinue
        }

        $result.ExitCode | Should -Be 0
        $health = Get-Content -LiteralPath (Join-Path $workspace 'logs/docker/health.log') -Raw
        $config = Get-Content -LiteralPath (Join-Path $workspace 'logs/docker/config.log') -Raw
        $appLogs = Get-Content -LiteralPath (Join-Path $workspace 'logs/docker/app-logs.log') -Raw

        $health | Should -Match 'All containers healthy\.'
        $config | Should -Match 'Valid\.'
        $appLogs | Should -Match 'app container healthy log line'

        Remove-Item -LiteralPath $workspace -Recurse -Force -ErrorAction SilentlyContinue
    }

}
