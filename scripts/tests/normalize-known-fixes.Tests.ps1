Set-StrictMode -Version Latest

Describe 'normalize-known-fixes hook script' {
    BeforeAll {
        . (Join-Path $PSScriptRoot 'TestHelpers.ps1')

        $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
        $sourceScript = Join-Path $repoRoot 'scripts/hooks/normalize-known-fixes.ps1'

        $script:ctx = @{
            SourceScript = $sourceScript
        }
    }

    It 'prunes stale zero-hit rows and preserves active rows' {
        $workspace = Join-Path $TestDrive 'repo-prune'
        $scriptsDir = Join-Path $workspace 'scripts/hooks'
        $skillDir = Join-Path $workspace '.claude/skills/fix-tests'

        New-Item -ItemType Directory -Path $scriptsDir -Force | Out-Null
        New-Item -ItemType Directory -Path $skillDir -Force | Out-Null
        Copy-Item -LiteralPath $script:ctx.SourceScript -Destination (Join-Path $scriptsDir 'normalize-known-fixes.ps1') -Force

        @'
# Known Test Fixes

| Error pattern (substring) | Root cause | Fix | Hits | Last used | Added |
|---|---|---|---|---|---|
| stale pattern | old issue | old fix | 0 | -- | 2025-01-01 |
| active pattern | still relevant | do thing | 1 | 2026-05-20 | 2026-04-01 |
'@ | Set-Content -LiteralPath (Join-Path $skillDir 'known-fixes.md') -Encoding utf8

        $result = Invoke-WorkspaceScript -Workspace $workspace -ScriptPath (Join-Path $scriptsDir 'normalize-known-fixes.ps1')
        $result.ExitCode | Should -Be 0

        $updated = Get-Content -LiteralPath (Join-Path $skillDir 'known-fixes.md') -Raw
        $updated | Should -Not -Match 'stale pattern'
        $updated | Should -Match 'active pattern'
        $updated | Should -Match '\|---\|---\|---\|---\|---\|---\|'
    }

    It 'dry-run reports potential changes without modifying files' {
        $workspace = Join-Path $TestDrive 'repo-dry-run'
        $scriptsDir = Join-Path $workspace 'scripts/hooks'
        $skillDir = Join-Path $workspace '.claude/skills/fix-logs'

        New-Item -ItemType Directory -Path $scriptsDir -Force | Out-Null
        New-Item -ItemType Directory -Path $skillDir -Force | Out-Null
        Copy-Item -LiteralPath $script:ctx.SourceScript -Destination (Join-Path $scriptsDir 'normalize-known-fixes.ps1') -Force

        @'
# Known Log Fixes

| Error pattern (substring) | Root cause | Fix | Hits | Last used | Added |
| --- | --- | --- | --- | --- | --- |
| sample pattern | reason | action | 0 | -- | 2026-05-01 |
'@ | Set-Content -LiteralPath (Join-Path $skillDir 'known-fixes.md') -Encoding utf8

        $before = Get-Content -LiteralPath (Join-Path $skillDir 'known-fixes.md') -Raw
        $result = Invoke-WorkspaceScript -Workspace $workspace -ScriptPath (Join-Path $scriptsDir 'normalize-known-fixes.ps1') -Arguments @('-DryRun')
        $result.ExitCode | Should -Be 0
        ($result.Output -join "`n") | Should -Match 'DRY RUN'

        $after = Get-Content -LiteralPath (Join-Path $skillDir 'known-fixes.md') -Raw
        $after | Should -Be $before
    }
}