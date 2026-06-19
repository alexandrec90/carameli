Set-StrictMode -Version Latest

Describe 'after-model-edit.py (Python PostToolUse hook)' {
    BeforeAll {
        $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
        $hookScript = Join-Path $repoRoot '.claude/skills/add-db-model/after-model-edit.py'
        $markerFile = Join-Path $repoRoot '.claude/skills/add-db-model/.migration-needed'

        $script:ctx = @{
            Script  = $hookScript
            Marker  = $markerFile
        }
    }

    BeforeEach {
        Remove-Item -LiteralPath $script:ctx.Marker -Force -ErrorAction SilentlyContinue
    }

    AfterEach {
        Remove-Item -LiteralPath $script:ctx.Marker -Force -ErrorAction SilentlyContinue
    }

    It 'skips and exits 0 for non-matching tool type' {
        $payload = '{"tool_name":"Read","tool_input":{"file_path":"app/models/customer.py"}}'
        $output = $payload | python3 $script:ctx.Script

        $LASTEXITCODE | Should -Be 0
        (Test-Path -LiteralPath $script:ctx.Marker) | Should -BeFalse
        ($output -join '') | Should -Not -Match 'MIGRATION NEEDED'
    }

    It 'skips when tool_input does not reference a model file' {
        $payload = '{"tool_name":"Edit","tool_input":{"file_path":"app/api/vsapi/calls.py"}}'
        $output = $payload | python3 $script:ctx.Script

        $LASTEXITCODE | Should -Be 0
        (Test-Path -LiteralPath $script:ctx.Marker) | Should -BeFalse
        ($output -join '') | Should -Not -Match 'MIGRATION NEEDED'
    }

    It 'does not fire again when marker already set (dedup guard)' {
        # Pre-set marker to simulate a prior trigger this session
        Set-Content -LiteralPath $script:ctx.Marker -Value 'pending' -Encoding utf8

        $payload = '{"tool_name":"Edit","tool_input":{"file_path":"app/models/phone_line.py"}}'
        $output = $payload | python3 $script:ctx.Script

        $LASTEXITCODE | Should -Be 0
        ($output -join '') | Should -Not -Match 'MIGRATION NEEDED'
    }

    It 'exits 0 and emits no reminder in a clean repo (no uncommitted model changes)' {
        # Relies on the repo having no uncommitted app/models/*.py changes.
        # Validated by: git status --porcelain -- app/models/*.py  (empty output)
        $payload = '{"tool_name":"Edit","tool_input":{"file_path":"app/models/customer.py"}}'
        $output = $payload | python3 $script:ctx.Script

        $LASTEXITCODE | Should -Be 0
        (Test-Path -LiteralPath $script:ctx.Marker) | Should -BeFalse
        ($output -join '') | Should -Not -Match 'MIGRATION NEEDED'
    }

    It 'handles empty stdin gracefully' {
        $output = '' | python3 $script:ctx.Script

        $LASTEXITCODE | Should -Be 0
    }
}
