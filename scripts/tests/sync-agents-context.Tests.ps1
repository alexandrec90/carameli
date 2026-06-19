#Requires -Modules Pester
<#
    Contract tests for scripts/sync-agents-context.ps1

    Tests run against a temp workspace so no live repo state is touched.
#>
Describe 'sync-agents-context.ps1' {

    BeforeAll {
        $script:scriptPath = Join-Path $PSScriptRoot '..' 'sync-agents-context.ps1'
        $workDir    = Join-Path $TestDrive 'workspace'
        New-Item -ItemType Directory -Path $workDir | Out-Null
    }

    Context 'CLAUDE.md -> AGENTS.md copying' {

        BeforeEach {
            # Root CLAUDE.md
            Set-Content -Path (Join-Path $workDir 'CLAUDE.md') -Value '# Root'
            # Subdir CLAUDE.md
            $sub = Join-Path $workDir 'frontend'
            New-Item -ItemType Directory -Path $sub -Force | Out-Null
            Set-Content -Path (Join-Path $sub 'CLAUDE.md') -Value '# Frontend'
        }

        It 'copies root CLAUDE.md to AGENTS.md' {
            & $script:scriptPath -Root $workDir
            $LASTEXITCODE | Should -Be 0
            $dest = Join-Path $workDir 'AGENTS.md'
            Test-Path $dest | Should -Be $true
            Get-Content $dest | Should -Be '# Root'
        }

        It 'copies subdir CLAUDE.md to AGENTS.md beside it' {
            & $script:scriptPath -Root $workDir
            $LASTEXITCODE | Should -Be 0
            $dest = Join-Path $workDir 'frontend' 'AGENTS.md'
            Test-Path $dest | Should -Be $true
            Get-Content $dest | Should -Be '# Frontend'
        }

        It 'overwrites a stale AGENTS.md with the current CLAUDE.md content' {
            Set-Content -Path (Join-Path $workDir 'AGENTS.md') -Value '# Stale'
            & $script:scriptPath -Root $workDir
            $LASTEXITCODE | Should -Be 0
            Get-Content (Join-Path $workDir 'AGENTS.md') | Should -Be '# Root'
        }
    }

    Context '.claude/ -> .agents/ mirroring' {

        BeforeEach {
            Set-Content -Path (Join-Path $workDir 'CLAUDE.md') -Value '# Root'
            $claudeDir = Join-Path $workDir '.claude'
            New-Item -ItemType Directory -Path $claudeDir -Force | Out-Null
            Set-Content -Path (Join-Path $claudeDir 'rules.md') -Value '# Rules'
        }

        It 'creates .agents/ mirroring .claude/' {
            & $script:scriptPath -Root $workDir
            $LASTEXITCODE | Should -Be 0
            $dest = Join-Path $workDir '.agents' 'rules.md'
            Test-Path $dest | Should -Be $true
            Get-Content $dest | Should -Be '# Rules'
        }

        It 'removes files from .agents/ that were deleted from .claude/' {
            # Pre-populate .agents/ with an orphan
            $agentsDir = Join-Path $workDir '.agents'
            New-Item -ItemType Directory -Path $agentsDir -Force | Out-Null
            Set-Content -Path (Join-Path $agentsDir 'orphan.md') -Value 'gone'

            & $script:scriptPath -Root $workDir
            $LASTEXITCODE | Should -Be 0
            Test-Path (Join-Path $agentsDir 'orphan.md') | Should -Be $false
        }

        It 'succeeds and skips mirror when .claude/ does not exist' {
            Remove-Item -Recurse -Force (Join-Path $workDir '.claude') -ErrorAction SilentlyContinue
            { & $script:scriptPath -Root $workDir } | Should -Not -Throw
            $LASTEXITCODE | Should -Be 0
        }
    }

    Context 'exit codes' {

        It 'exits 0 on a clean run' {
            Set-Content -Path (Join-Path $workDir 'CLAUDE.md') -Value '# Root'
            & $script:scriptPath -Root $workDir
            $LASTEXITCODE | Should -Be 0
        }
    }
}
