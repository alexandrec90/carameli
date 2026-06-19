Set-StrictMode -Version Latest

Describe 'Bash cap hook scripts' {
    # The enforcer (enforce-capped-bash) is now Python; its contract is covered
    # by scripts/hooks/tests/test_enforce_capped_bash.py. This file covers only
    # the still-PowerShell invoke-capped.ps1 wrapper.
    BeforeAll {
        $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
        $invokeScript = Join-Path $repoRoot 'scripts/hooks/invoke-capped.ps1'

        $script:ctx = @{
            InvokeScript = $invokeScript
        }
    }

    It 'invoke-capped preserves command exit code' {
        & pwsh -NoProfile -ExecutionPolicy Bypass -File $script:ctx.InvokeScript -Command 'Write-Output "ok"; exit 7' -MaxBytes 4000 | Out-Null
        $LASTEXITCODE | Should -Be 7
    }

    It 'invoke-capped truncates oversized output with marker' {
        $out = & pwsh -NoProfile -ExecutionPolicy Bypass -File $script:ctx.InvokeScript -Command '$x = "a" * 12000; Write-Output $x' -MaxBytes 2000 -HeadBytes 1000
        $LASTEXITCODE | Should -Be 0
        ($out -join "`n") | Should -Match '\[truncated bytes='
    }
}
