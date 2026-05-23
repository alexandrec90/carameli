[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('hook', 'bang')]
    [string]$Mode
)

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$logDir = Join-Path $repoRoot 'logs/agent'
$timestamp = (Get-Date).ToUniversalTime().ToString('o')

New-Item -ItemType Directory -Path $logDir -Force | Out-Null

if ($Mode -eq 'hook') {
    Set-Content -Path (Join-Path $logDir 'test-skill-hook.txt') -Value ('hello from frontmatter hook at ' + $timestamp)
    exit 0
}

Set-Content -Path (Join-Path $logDir 'test-skill-bang.txt') -Value ('hello from bang command at ' + $timestamp)
Set-Content -Path (Join-Path $logDir 'test-skill-sentinel.txt') -Value ('hello from test-skill at ' + $timestamp)

Get-Content -Path (Join-Path $logDir 'test-skill-bang.txt')
Get-Content -Path (Join-Path $logDir 'test-skill-sentinel.txt')

exit 0
