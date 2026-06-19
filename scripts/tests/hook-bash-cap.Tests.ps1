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

Describe 'Bash cap hook scripts (Python)' {
    BeforeAll {
        $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
        $script:ctx = @{
            EnforceScript = Join-Path $repoRoot 'scripts/hooks/enforce-capped-bash.py'
            InvokeScript  = Join-Path $repoRoot 'scripts/hooks/invoke-capped.py'
        }
    }

    It 'enforcer allows non-Bash payloads' {
        $payload = '{"tool_name":"Read","tool_input":{"file_path":"README.md"}}'
        $payload | python3 $script:ctx.EnforceScript | Out-Null
        $LASTEXITCODE | Should -Be 0
    }

    It 'enforcer blocks uncapped Bash commands' {
        $payload = '{"tool_name":"Bash","tool_input":{"command":"echo hello"}}'
        $output = $payload | python3 $script:ctx.EnforceScript

        $LASTEXITCODE | Should -Be 42
        ($output -join "`n") | Should -Match 'Blocked uncapped Bash command'
    }

    It 'enforcer allows Bash commands using invoke-capped.py wrapper' {
        $payload = '{"tool_name":"Bash","tool_input":{"command":"python3 scripts/hooks/invoke-capped.py --command \"echo hi\" --max-bytes 4000"}}'
        $payload | python3 $script:ctx.EnforceScript | Out-Null
        $LASTEXITCODE | Should -Be 0
    }

    It 'enforcer allows Bash commands using head -c cap pattern' {
        $payload = '{"tool_name":"Bash","tool_input":{"command":"cat file.txt | head -c 4000"}}'
        $payload | python3 $script:ctx.EnforceScript | Out-Null
        $LASTEXITCODE | Should -Be 0
    }

    It 'enforcer exits 0 on empty stdin' {
        '' | python3 $script:ctx.EnforceScript | Out-Null
        $LASTEXITCODE | Should -Be 0
    }

    It 'invoke-capped.py preserves command exit code' {
        python3 $script:ctx.InvokeScript --command 'exit 7' --max-bytes 4000 | Out-Null
        $LASTEXITCODE | Should -Be 7
    }

    It 'invoke-capped.py passes through small output unchanged' {
        $out = python3 $script:ctx.InvokeScript --command 'echo hello' --max-bytes 4000
        $LASTEXITCODE | Should -Be 0
        ($out -join '') | Should -Match 'hello'
    }

    It 'invoke-capped.py truncates oversized output with marker' {
        $big = 'python3 -c "print(\"a\" * 12000)"'
        $out = python3 $script:ctx.InvokeScript --command $big --max-bytes 2000 --head-bytes 1000
        $LASTEXITCODE | Should -Be 0
        ($out -join "`n") | Should -Match '\[truncated bytes='
    }
}
