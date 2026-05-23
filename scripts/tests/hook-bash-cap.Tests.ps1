Set-StrictMode -Version Latest

Describe 'Bash cap hook scripts' {
    BeforeAll {
        $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
        $enforceScript = Join-Path $repoRoot 'scripts/hooks/enforce-capped-bash.ps1'
        $invokeScript = Join-Path $repoRoot 'scripts/hooks/invoke-capped.ps1'

        $script:ctx = @{
            EnforceScript = $enforceScript
            InvokeScript = $invokeScript
        }
    }

    It 'enforcer allows non-Bash payloads' {
        $payload = '{"tool_name":"Read","tool_input":{"file_path":"README.md"}}'
        $payload | & pwsh -NoProfile -ExecutionPolicy Bypass -File $script:ctx.EnforceScript | Out-Null
        $LASTEXITCODE | Should -Be 0
    }

    It 'enforcer blocks uncapped Bash commands' {
        $payload = '{"tool_name":"Bash","tool_input":{"command":"echo hello"}}'
        $output = $payload | & pwsh -NoProfile -ExecutionPolicy Bypass -File $script:ctx.EnforceScript

        $LASTEXITCODE | Should -Be 42
        ($output -join "`n") | Should -Match 'Blocked uncapped Bash command'
    }

    It 'enforcer allows Bash commands using invoke-capped wrapper' {
        $payload = '{"tool_name":"Bash","tool_input":{"command":"pwsh -File scripts/hooks/invoke-capped.ps1 -Command \"echo hi\" -MaxBytes 4000"}}'
        $payload | & pwsh -NoProfile -ExecutionPolicy Bypass -File $script:ctx.EnforceScript | Out-Null
        $LASTEXITCODE | Should -Be 0
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
