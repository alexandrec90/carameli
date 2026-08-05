<#
.SYNOPSIS
Tests which safe Carameli/VanillaSoft diagnostic channels the current server identity can use.

.DESCRIPTION
Runs non-mutating HTTPS, Windows Event Log, file-read, TCP, and SQL permission checks.
It writes a redacted JSON report beside the script by default. It does not POST a
webhook, return database rows, or include log contents in the report.

.EXAMPLE
.\carameli-preflight.ps1 -CarameliUrl 'https://example.ngrok.app' -SkipEventLog

.EXAMPLE
.\carameli-preflight.ps1 -CarameliUrl 'https://example.ngrok.app' `
  -SqlHost 'sql-staging.example.com' -SqlDatabase 'VanillaSoft' `
  -SqlReadObject 'dbo.IntendedTable' -LogPath 'C:\logs\vanillasoft.log'
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^https?://')]
    [string] $CarameliUrl,

    [ValidatePattern('^$|^https?://')]
    [string] $VanillaSoftNotifyUrl = '',

    [string] $SqlHost = '',

    [ValidateRange(1, 65535)]
    [int] $SqlPort = 1433,

    [string] $SqlDatabase = '',

    [string] $SqlReadObject = '',

    [System.Management.Automation.PSCredential] $SqlCredential,

    [switch] $DisableSqlEncryption,

    [switch] $TrustSqlServerCertificate,

    [string] $LogPath = '',

    [string] $EventLogName = 'Application',

    [switch] $SkipEventLog,

    [ValidateRange(1, 300)]
    [int] $TimeoutSeconds = 10,

    [string] $OutputPath = (Join-Path $PSScriptRoot 'carameli-preflight-result.json')
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Get-SafeErrorMessage {
    param([Parameter(Mandatory = $true)] $ErrorRecord)

    $message = [string] $ErrorRecord.Exception.Message
    $message = $message -replace '(?i)(password|pwd)\s*=\s*[^;\s]+', '$1=<redacted>'
    return ($message -replace '\s+', ' ').Trim()
}

function New-CheckResult {
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $Direction,
        [Parameter(Mandatory = $true)][string] $Target,
        [Parameter(Mandatory = $true)][ValidateSet('pass', 'fail', 'not_run')][string] $Status,
        [Parameter(Mandatory = $true)][string] $Detail
    )

    return [pscustomobject][ordered]@{
        name      = $Name
        direction = $Direction
        target    = $Target
        status    = $Status
        detail    = $Detail
    }
}

function Invoke-Check {
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $Direction,
        [Parameter(Mandatory = $true)][string] $Target,
        [Parameter(Mandatory = $true)][scriptblock] $Action
    )

    try {
        $detail = & $Action
        if ([string]::IsNullOrWhiteSpace([string] $detail)) {
            $detail = 'check completed'
        }
        return New-CheckResult -Name $Name -Direction $Direction -Target $Target `
            -Status 'pass' -Detail ([string] $detail)
    }
    catch {
        return New-CheckResult -Name $Name -Direction $Direction -Target $Target `
            -Status 'fail' -Detail (Get-SafeErrorMessage $_)
    }
}

function New-NotRunResult {
    param(
        [Parameter(Mandatory = $true)][string] $Name,
        [Parameter(Mandatory = $true)][string] $Direction,
        [Parameter(Mandatory = $true)][string] $Detail
    )

    return New-CheckResult -Name $Name -Direction $Direction -Target '(not configured)' `
        -Status 'not_run' -Detail $Detail
}

function Invoke-TcpConnect {
    param(
        [Parameter(Mandatory = $true)][string] $HostName,
        [Parameter(Mandatory = $true)][int] $Port,
        [Parameter(Mandatory = $true)][int] $Timeout
    )

    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $pending = $client.BeginConnect($HostName, $Port, $null, $null)
        if (-not $pending.AsyncWaitHandle.WaitOne($Timeout * 1000)) {
            throw "TCP connection timed out after $Timeout seconds"
        }
        $client.EndConnect($pending)
        return "TCP connection to ${HostName}:$Port succeeded"
    }
    finally {
        $client.Dispose()
    }
}

function Get-SqlObjectName {
    param([Parameter(Mandatory = $true)][string] $Name)

    if ($Name -notmatch '^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$') {
        throw 'SqlReadObject must be table or schema.table using only letters, numbers, and underscores'
    }
    return (($Name -split '\.' | ForEach-Object { "[$_]" }) -join '.')
}

function New-SqlConnection {
    param(
        [Parameter(Mandatory = $true)][string] $HostName,
        [Parameter(Mandatory = $true)][int] $Port,
        [Parameter(Mandatory = $true)][string] $Database,
        [Parameter(Mandatory = $true)][int] $Timeout,
        [System.Management.Automation.PSCredential] $Credential,
        [Parameter(Mandatory = $true)][bool] $Encrypt,
        [Parameter(Mandatory = $true)][bool] $TrustCertificate
    )

    $builder = New-Object System.Data.SqlClient.SqlConnectionStringBuilder
    $builder['Data Source'] = "${HostName},$Port"
    $builder['Initial Catalog'] = $Database
    $builder['Connect Timeout'] = $Timeout
    $builder['Application Name'] = 'Carameli Preflight'
    $builder['Encrypt'] = $Encrypt
    $builder['TrustServerCertificate'] = $TrustCertificate

    if ($null -eq $Credential) {
        $builder['Integrated Security'] = $true
    }
    else {
        $builder['Integrated Security'] = $false
        $builder['User ID'] = $Credential.UserName
        $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR(
            $Credential.Password
        )
        try {
            $builder['Password'] = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
                $passwordPointer
            )
        }
        finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
        }
    }

    return New-Object System.Data.SqlClient.SqlConnection($builder.ConnectionString)
}

function Invoke-VanillaSoftRouteCheck {
    param(
        [Parameter(Mandatory = $true)][string] $Url,
        [Parameter(Mandatory = $true)][int] $Timeout
    )

    try {
        $response = Invoke-WebRequest -Uri $Url -Method Get -UseBasicParsing `
            -TimeoutSec $Timeout
        return "route answered HTTP $([int] $response.StatusCode); GET only, no webhook was posted"
    }
    catch {
        $response = $_.Exception.Response
        if ($null -eq $response) {
            throw
        }
        $status = [int] $response.StatusCode
        if ($status -eq 404) {
            throw 'route answered HTTP 404; it is not deployed at this URL'
        }
        return "route answered HTTP $status; the route exists, and GET caused no webhook write"
    }
}

$checks = @()
$healthUrl = $CarameliUrl.TrimEnd('/') + '/health'
$checks += Invoke-Check -Name 'carameli-health' -Direction 'VanillaSoft -> Carameli' `
    -Target $healthUrl -Action {
        $response = Invoke-WebRequest -Uri $healthUrl -Method Get -UseBasicParsing `
            -TimeoutSec $TimeoutSeconds
        "HTTP $([int] $response.StatusCode)"
    }

if ([string]::IsNullOrWhiteSpace($VanillaSoftNotifyUrl)) {
    $checks += New-NotRunResult -Name 'vanillasoft-notify-route' `
        -Direction 'VanillaSoft host -> VanillaSoft app' `
        -Detail 'pass -VanillaSoftNotifyUrl to test route existence with a non-mutating GET'
}
else {
    $checks += Invoke-Check -Name 'vanillasoft-notify-route' `
        -Direction 'VanillaSoft host -> VanillaSoft app' -Target $VanillaSoftNotifyUrl `
        -Action {
            Invoke-VanillaSoftRouteCheck -Url $VanillaSoftNotifyUrl -Timeout $TimeoutSeconds
        }
}

if ($SkipEventLog) {
    $checks += New-NotRunResult -Name 'windows-event-log-read' `
        -Direction 'local Windows identity -> Event Log' `
        -Detail 'skipped because -SkipEventLog was supplied'
}
else {
    $checks += Invoke-Check -Name 'windows-event-log-read' `
        -Direction 'local Windows identity -> Event Log' -Target $EventLogName -Action {
            $null = Get-WinEvent -ListLog $EventLogName -ErrorAction Stop
            $null = Get-WinEvent -FilterHashtable @{ LogName = $EventLogName } `
                -MaxEvents 1 -ErrorAction Stop
            'event log is readable; event contents were not emitted'
        }
}

if ([string]::IsNullOrWhiteSpace($LogPath)) {
    $checks += New-NotRunResult -Name 'log-file-read' `
        -Direction 'local Windows identity -> log file' `
        -Detail 'pass -LogPath to test file read permission without emitting its contents'
}
else {
    $checks += Invoke-Check -Name 'log-file-read' `
        -Direction 'local Windows identity -> log file' -Target $LogPath -Action {
            $stream = [System.IO.File]::Open(
                $LogPath,
                [System.IO.FileMode]::Open,
                [System.IO.FileAccess]::Read,
                [System.IO.FileShare]::ReadWrite
            )
            try {
                $null = $stream.ReadByte()
            }
            finally {
                $stream.Dispose()
            }
            'file opened for read; file contents were not emitted'
        }
}

if ([string]::IsNullOrWhiteSpace($SqlHost)) {
    foreach ($name in @('sql-tcp', 'sql-login', 'sql-object-read')) {
        $checks += New-NotRunResult -Name $name `
            -Direction 'VanillaSoft host -> SQL Server' `
            -Detail 'pass -SqlHost to enable SQL connectivity checks'
    }
}
else {
    $sqlTarget = "${SqlHost}:$SqlPort"
    $database = if ([string]::IsNullOrWhiteSpace($SqlDatabase)) { 'master' } else { $SqlDatabase }
    $encrypt = -not $DisableSqlEncryption
    $trustCertificate = [bool] $TrustSqlServerCertificate

    $checks += Invoke-Check -Name 'sql-tcp' -Direction 'VanillaSoft host -> SQL Server' `
        -Target $sqlTarget -Action {
            Invoke-TcpConnect -HostName $SqlHost -Port $SqlPort -Timeout $TimeoutSeconds
        }

    $checks += Invoke-Check -Name 'sql-login' `
        -Direction 'current/explicit identity -> SQL Server' -Target "$sqlTarget/$database" `
        -Action {
            $connection = New-SqlConnection -HostName $SqlHost -Port $SqlPort `
                -Database $database -Timeout $TimeoutSeconds -Credential $SqlCredential `
                -Encrypt $encrypt -TrustCertificate $trustCertificate
            try {
                $connection.Open()
            }
            finally {
                $connection.Dispose()
            }
            'SQL login succeeded; no query was executed'
        }

    if ([string]::IsNullOrWhiteSpace($SqlReadObject)) {
        $checks += New-NotRunResult -Name 'sql-object-read' `
            -Direction 'current/explicit identity -> SQL object' `
            -Detail 'pass -SqlDatabase and -SqlReadObject schema.table to test SELECT permission without returning rows'
    }
    else {
        $checks += Invoke-Check -Name 'sql-object-read' `
            -Direction 'current/explicit identity -> SQL object' `
            -Target "$sqlTarget/$database/$SqlReadObject" -Action {
                if ([string]::IsNullOrWhiteSpace($SqlDatabase)) {
                    throw 'SqlDatabase is required when SqlReadObject is supplied'
                }
                $safeObjectName = Get-SqlObjectName $SqlReadObject
                $connection = New-SqlConnection -HostName $SqlHost -Port $SqlPort `
                    -Database $SqlDatabase -Timeout $TimeoutSeconds `
                    -Credential $SqlCredential -Encrypt $encrypt `
                    -TrustCertificate $trustCertificate
                try {
                    $connection.Open()
                    $command = $connection.CreateCommand()
                    $command.CommandText = "SELECT TOP (0) * FROM $safeObjectName"
                    $reader = $command.ExecuteReader()
                    try {
                        $null = $reader.FieldCount
                    }
                    finally {
                        $reader.Dispose()
                        $command.Dispose()
                    }
                }
                finally {
                    $connection.Dispose()
                }
                'SELECT permission succeeded; zero rows and no column values were returned'
            }
    }
}

try {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
}
catch {
    $identity = [Environment]::UserName
}

$failed = @($checks | Where-Object { $_.status -eq 'fail' }).Count
$passed = @($checks | Where-Object { $_.status -eq 'pass' }).Count
$notRun = @($checks | Where-Object { $_.status -eq 'not_run' }).Count
$overall = if ($failed -eq 0) { 'pass' } else { 'attention_required' }

$report = [pscustomobject][ordered]@{
    schemaVersion  = 1
    generatedAtUtc = [DateTime]::UtcNow.ToString('o')
    computerName   = [Environment]::MachineName
    identity       = $identity
    overall        = $overall
    counts         = [pscustomobject][ordered]@{
        passed = $passed
        failed = $failed
        notRun = $notRun
    }
    checks         = $checks
}

$fullOutputPath = [System.IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $fullOutputPath
if (-not [string]::IsNullOrWhiteSpace($outputDirectory)) {
    $null = New-Item -ItemType Directory -Path $outputDirectory -Force
}
$json = $report | ConvertTo-Json -Depth 6
$utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($fullOutputPath, $json, $utf8WithoutBom)

foreach ($check in $checks) {
    $label = $check.status.ToUpperInvariant().PadRight(7)
    Write-Host "[$label] $($check.name) - $($check.detail)"
}
Write-Host "Result: $overall ($passed passed, $failed failed, $notRun not run)"
Write-Host "Report: $fullOutputPath"

if ($failed -gt 0) {
    exit 1
}
exit 0
