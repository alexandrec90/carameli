Set-StrictMode -Version Latest

Describe 'Hook dispatcher scripts' {
    BeforeAll {
        $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
        $preToolScript = Join-Path $repoRoot 'scripts/hooks/copilot-settings-pretool.ps1'
        $stopScript = Join-Path $repoRoot 'scripts/hooks/copilot-settings-stop.ps1'

        $testMarker = Join-Path $repoRoot '.claude/skills/test-skill/.active'
        $fixTestsMarker = Join-Path $repoRoot '.claude/skills/fix-tests-auto/.active'
        $hookArtifact = Join-Path $repoRoot 'logs/agent/test-skill-hook.txt'

        $script:ctx = @{
            RepoRoot = $repoRoot
            PreToolScript = $preToolScript
            StopScript = $stopScript
            TestMarker = $testMarker
            FixTestsMarker = $fixTestsMarker
            HookArtifact = $hookArtifact
        }
    }

    BeforeEach {
        Remove-Item -LiteralPath $script:ctx.TestMarker -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $script:ctx.FixTestsMarker -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $script:ctx.HookArtifact -Force -ErrorAction SilentlyContinue
    }

    AfterEach {
        Remove-Item -LiteralPath $script:ctx.TestMarker -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $script:ctx.FixTestsMarker -Force -ErrorAction SilentlyContinue
    }

    It 'PreToolUse no-ops with no markers' {
        & pwsh -NoProfile -ExecutionPolicy Bypass -File $script:ctx.PreToolScript
        $LASTEXITCODE | Should -Be 0
        (Test-Path -LiteralPath $script:ctx.HookArtifact) | Should -BeFalse
    }

    It 'PreToolUse writes artifact when test marker exists' {
        New-Item -ItemType File -Path $script:ctx.TestMarker -Force | Out-Null

        & pwsh -NoProfile -ExecutionPolicy Bypass -File $script:ctx.PreToolScript
        $LASTEXITCODE | Should -Be 0

        (Test-Path -LiteralPath $script:ctx.HookArtifact) | Should -BeTrue
        $artifactLine = (Get-Content -LiteralPath $script:ctx.HookArtifact -Raw).Trim()
        $artifactLine | Should -Match '^hello from frontmatter hook at '
    }

    It 'PreToolUse dry-run does not write artifact even when marker exists' {
        New-Item -ItemType File -Path $script:ctx.TestMarker -Force | Out-Null

        & pwsh -NoProfile -ExecutionPolicy Bypass -File $script:ctx.PreToolScript -DryRun | Out-Null
        $LASTEXITCODE | Should -Be 0

        (Test-Path -LiteralPath $script:ctx.HookArtifact) | Should -BeFalse
    }

    It 'Stop hook dry-run exits cleanly' {
        & pwsh -NoProfile -ExecutionPolicy Bypass -File $script:ctx.StopScript -DryRun | Out-Null
        $LASTEXITCODE | Should -Be 0
    }
}
