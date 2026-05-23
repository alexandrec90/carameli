[CmdletBinding()]
param(
    [int]$DefaultMaxBytes = 4000
)

$ErrorActionPreference = 'Stop'

# Hooks normally provide a JSON payload on stdin. If none is available,
# fail open to avoid breaking unrelated workflows.
$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) {
    exit 0
}

try {
    $payload = $raw | ConvertFrom-Json -Depth 20
}
catch {
    Write-Output 'enforce-capped-bash: unable to parse hook payload; skipping enforcement.'
    exit 0
}

function Get-JsonValue {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Object,
        [Parameter(Mandatory = $true)]
        [string[]]$Paths
    )

    foreach ($path in $Paths) {
        $current = $Object
        $ok = $true
        foreach ($segment in ($path -split '\.')) {
            if ($null -eq $current) {
                $ok = $false
                break
            }

            $prop = $current.PSObject.Properties[$segment]
            if ($null -eq $prop) {
                $ok = $false
                break
            }

            $current = $prop.Value
        }

        if ($ok -and $null -ne $current) {
            return [string]$current
        }
    }

    return $null
}

$toolName = Get-JsonValue -Object $payload -Paths @(
    'tool_name',
    'toolName',
    'tool.name',
    'name'
)

if ($toolName -ne 'Bash') {
    exit 0
}

$command = Get-JsonValue -Object $payload -Paths @(
    'tool_input.command',
    'toolInput.command',
    'input.command',
    'command'
)

if ([string]::IsNullOrWhiteSpace($command)) {
    Write-Output 'enforce-capped-bash: Bash tool call is missing command text; blocking by policy.'
    exit 42
}

# Allow known capped-output patterns.
$allowedPatterns = @(
    'scripts/hooks/invoke-capped.ps1',
    '\|\s*head\s*-c\s*\d+',
    'Set-Content\s+.+\|\s*Out-Null'
)

$isCapped = $false
foreach ($pattern in $allowedPatterns) {
    if ($command -match $pattern) {
        $isCapped = $true
        break
    }
}

if ($isCapped) {
    exit 0
}

Write-Output ('Blocked uncapped Bash command. Route command output through a byte cap wrapper (default {0} bytes).' -f $DefaultMaxBytes)
Write-Output 'Suggested pattern: pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/hooks/invoke-capped.ps1 -Command "<your command>" -MaxBytes 4000'
exit 42
