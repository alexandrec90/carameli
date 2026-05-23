Set-StrictMode -Version Latest

Describe 'extract-log-errors.ps1' {
    BeforeAll {
  . (Join-Path $PSScriptRoot 'TestHelpers.ps1')
    }

    It 'extracts warnings and errors, dedupes messages, and filters third-party traceback frames' {
        $workspace = Join-Path ([System.IO.Path]::GetTempPath()) ('carameli-logtest-' + [guid]::NewGuid())
        New-Item -ItemType Directory -Path (Join-Path $workspace 'logs/runtime') -Force | Out-Null

        @'
2026-05-20 10:00:00.000 | INFO     | app.main:1 | startup noise
2026-05-21 11:00:00.000 | ERROR    | app.api.sms:56 | boom happened
Traceback (most recent call last):
  File "/usr/local/lib/python3.12/site-packages/sqlalchemy/foo.py", line 1, in x
    nope
  File "/app/app/api/sms.py", line 56, in handler
    raise RuntimeError("broken")
RuntimeError: broken
2026-05-21 12:00:00.000 | WARNING  | app.api.sms:57 | be careful
2026-05-21 13:00:00.000 | ERROR    | app.api.sms:56 | boom happened
Traceback (most recent call last):
  File "/app/app/api/sms.py", line 56, in handler
    raise RuntimeError("broken")
RuntimeError: broken
'@ | Set-Content -LiteralPath (Join-Path $workspace 'logs/runtime/carameli.log') -Encoding utf8

        $result = Invoke-WorkspaceScript -Workspace $workspace -ScriptPath (Join-Path ((Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path) 'scripts/extract-log-errors.ps1')
        $result.ExitCode | Should -Be 1

        $artifact = Get-Content -LiteralPath (Join-Path $workspace 'logs/log-errors.log') -Raw
        $artifact | Should -Match '\| ERROR\s+\| app.api.sms:56 \| boom happened'
        $artifact | Should -Match '\| WARNING\s+\| app.api.sms:57 \| be careful'
        $artifact | Should -Not -Match 'sqlalchemy'
        $artifact | Should -Match 'RuntimeError: broken'
        ([regex]::Matches($artifact, 'boom happened')).Count | Should -Be 1

        Remove-Item -LiteralPath $workspace -Recurse -Force -ErrorAction SilentlyContinue
    }

    It 'clears artifact and exits zero when no warning or error lines exist' {
        $workspace = Join-Path ([System.IO.Path]::GetTempPath()) ('carameli-logtest-' + [guid]::NewGuid())
        New-Item -ItemType Directory -Path (Join-Path $workspace 'logs/runtime') -Force | Out-Null

        '2026-05-21 10:00:00.000 | INFO     | app.main:1 | all good' |
            Set-Content -LiteralPath (Join-Path $workspace 'logs/runtime/carameli.log') -Encoding utf8

        $result = Invoke-WorkspaceScript -Workspace $workspace -ScriptPath (Join-Path ((Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path) 'scripts/extract-log-errors.ps1')
        $result.ExitCode | Should -Be 0

        $artifact = Get-Content -LiteralPath (Join-Path $workspace 'logs/log-errors.log') -Raw
        $artifact.Trim() | Should -Be ''

        Remove-Item -LiteralPath $workspace -Recurse -Force -ErrorAction SilentlyContinue
    }
}
