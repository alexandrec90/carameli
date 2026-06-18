Set-StrictMode -Version Latest

Describe 'enforce-audit-batch-caps hook' {
    BeforeAll {
        $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
        $scriptPath = Join-Path $repoRoot 'scripts/hooks/enforce-audit-batch-caps.ps1'

        $tempRoot = Join-Path $env:TEMP ("carameli-batch-caps-" + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
        New-Item -ItemType Directory -Path (Join-Path $tempRoot '.claude/skills/audit-design-flaws') -Force | Out-Null

        $script:ctx = @{
            ScriptPath = $scriptPath
            TempRoot = $tempRoot
            SkillDir = Join-Path $tempRoot '.claude/skills/audit-design-flaws'
            RawAuditPath = Join-Path $tempRoot '.claude/skills/audit-design-flaws/raw-audit.json'
            BatchPlanPath = Join-Path $tempRoot '.claude/skills/audit-design-flaws/batch-plan.json'
            BatchActivePath = Join-Path $tempRoot '.claude/skills/audit-design-flaws/batch-active.json'
        }
    }

    AfterAll {
        Remove-Item -LiteralPath $script:ctx.TempRoot -Force -Recurse -ErrorAction SilentlyContinue
    }

    BeforeEach {
        Remove-Item -LiteralPath $script:ctx.RawAuditPath -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $script:ctx.BatchPlanPath -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $script:ctx.BatchActivePath -Force -ErrorAction SilentlyContinue
    }

    It 'no-ops when raw-audit artifact is absent' {
        $payload = '{"tool_name":"apply_patch","tool_input":{"patch":"*** Update File: app/api/auth.py"}}'
        $payload | & pwsh -NoProfile -ExecutionPolicy Bypass -File $script:ctx.ScriptPath -RepoRoot $script:ctx.TempRoot
        $LASTEXITCODE | Should -Be 0
        (Test-Path -LiteralPath $script:ctx.BatchPlanPath) | Should -BeFalse
    }

    It 'creates batch-plan and allows in-batch file edits' {
        $iViolations = @()
        foreach ($n in 1..26) {
            $iViolations += @{
                type = 'skip_or_xfail'
                file = 'tests/unit/test_sample.py'
                line = $n
                match = '@pytest.mark.skip'
            }
        }

        $rawAudit = @{
            generatedAt = '2026-05-24T00:00:00Z'
            violations = @{
                E = @(
                    @{
                        file = 'app/api/auth.py'
                        line = 50
                        text = 'TODO: example'
                    }
                )
                F = @()
                G = @()
                I = $iViolations
                L = @()
                B = @()
                C = @()
                J = @()
                K = @()
                A = @(
                    @{
                        file = 'frontend/src/skins/comic-book/Layout.tsx'
                        lines = 1036
                        limit = 250
                    }
                )
                D = @()
                H = @()
            }
        }
        $rawAudit | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $script:ctx.RawAuditPath -Encoding utf8

        $payload = '{"tool_name":"apply_patch","tool_input":{"patch":"*** Update File: app/api/auth.py\n"}}'
        $payload | & pwsh -NoProfile -ExecutionPolicy Bypass -File $script:ctx.ScriptPath -RepoRoot $script:ctx.TempRoot
        $LASTEXITCODE | Should -Be 0

        (Test-Path -LiteralPath $script:ctx.BatchPlanPath) | Should -BeTrue
        (Test-Path -LiteralPath $script:ctx.BatchActivePath) | Should -BeTrue

        $plan = Get-Content -LiteralPath $script:ctx.BatchPlanPath -Raw | ConvertFrom-Json -Depth 20
        $plan.currentBatchId | Should -Be 'low-1'
        @($plan.batches).Count | Should -BeGreaterThan 0
    }

    It 'blocks edits outside the active batch' {
        $iViolations = @()
        foreach ($n in 1..26) {
            $iViolations += @{
                type = 'skip_or_xfail'
                file = 'tests/unit/test_sample.py'
                line = $n
                match = '@pytest.mark.skip'
            }
        }

        $rawAudit = @{
            generatedAt = '2026-05-24T00:00:00Z'
            violations = @{
                E = @(
                    @{
                        file = 'app/api/auth.py'
                        line = 50
                        text = 'TODO: example'
                    }
                )
                F = @()
                G = @()
                I = $iViolations
                L = @()
                B = @()
                C = @()
                J = @()
                K = @()
                A = @(
                    @{
                        file = 'frontend/src/skins/comic-book/Layout.tsx'
                        lines = 1036
                        limit = 250
                    }
                )
                D = @()
                H = @()
            }
        }
        $rawAudit | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $script:ctx.RawAuditPath -Encoding utf8

        # First call creates plan + active batch (low-1)
        $seedPayload = '{"tool_name":"apply_patch","tool_input":{"patch":"*** Update File: app/api/auth.py\n"}}'
        $seedPayload | & pwsh -NoProfile -ExecutionPolicy Bypass -File $script:ctx.ScriptPath -RepoRoot $script:ctx.TempRoot
        $LASTEXITCODE | Should -Be 0

        # This file belongs to high-risk batch, so it must be blocked while low-1 is active
        $badPayload = '{"tool_name":"apply_patch","tool_input":{"patch":"*** Update File: frontend/src/skins/comic-book/Layout.tsx\n"}}'
        $badPayload | & pwsh -NoProfile -ExecutionPolicy Bypass -File $script:ctx.ScriptPath -RepoRoot $script:ctx.TempRoot | Out-Null
        $LASTEXITCODE | Should -Be 42
    }
}
