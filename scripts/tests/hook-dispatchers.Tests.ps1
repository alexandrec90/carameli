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

Describe 'stop.py (Python Stop hook)' {
    BeforeAll {
        $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
        $stopPy = Join-Path $repoRoot 'scripts/hooks/stop.py'
        $profile = Join-Path $repoRoot 'logs/agent/skills-profile.json'
        $snapshot = Join-Path $repoRoot 'logs/agent/skills-profile.optimized.json'

        $script:ctx = @{
            StopPy   = $stopPy
            Profile  = $profile
            Snapshot = $snapshot
            LogDir   = (Split-Path $profile -Parent)
        }
    }

    BeforeEach {
        Remove-Item -LiteralPath $script:ctx.Profile -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $script:ctx.Snapshot -Force -ErrorAction SilentlyContinue
    }

    AfterEach {
        Remove-Item -LiteralPath $script:ctx.Profile -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $script:ctx.Snapshot -Force -ErrorAction SilentlyContinue
    }

    It 'exits 0 and creates no snapshot when profile is absent' {
        python3 $script:ctx.StopPy | Out-Null
        $LASTEXITCODE | Should -Be 0
        (Test-Path -LiteralPath $script:ctx.Snapshot) | Should -BeFalse
    }

    It 'saves snapshot when profile exists' {
        New-Item -ItemType Directory -Path $script:ctx.LogDir -Force | Out-Null
        Set-Content -LiteralPath $script:ctx.Profile -Value '{"test":1}' -Encoding utf8

        python3 $script:ctx.StopPy | Out-Null
        $LASTEXITCODE | Should -Be 0
        (Test-Path -LiteralPath $script:ctx.Snapshot) | Should -BeTrue
        (Get-Content -LiteralPath $script:ctx.Snapshot -Raw) | Should -Match '"test"'
    }
}
