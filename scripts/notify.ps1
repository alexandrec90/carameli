# Show a Windows toast notification when a VS Code task finishes.
# Usage: pwsh -ExecutionPolicy Bypass -File scripts/notify.ps1 -Label 'Task Name' -ExitCode 0

param(
    [Parameter(Mandatory)][string]$Label,
    [int]$ExitCode = 0
)

if ($ExitCode -eq 0) {
    $title = "Carameli - Task Complete"
    $body = "$Label finished successfully"
}
else {
    $title = "Carameli - Task Failed"
    $body = "$Label failed (exit code $ExitCode)"
}

$notified = $false

# Preferred in PowerShell 7: BurntToast module if available.
try {
    if (Get-Command -Name New-BurntToastNotification -ErrorAction SilentlyContinue) {
        New-BurntToastNotification -Text $title, $body | Out-Null
        $notified = $true
    }
}
catch {
    $notified = $false
}

# Legacy fallback: WinRT toast API (works in some host/runtime combinations).
if (-not $notified) {
    try {
        [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
        [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null

        $template = @"
<toast>
  <visual>
  <binding template="ToastGeneric">
    <text>$title</text>
    <text>$body</text>
  </binding>
  </visual>
</toast>
"@
        $xml = [Windows.Data.Xml.Dom.XmlDocument]::new()
        $xml.LoadXml($template)

        $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
        $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show($toast)
        $notified = $true
    }
    catch {
        $notified = $false
    }
}

if (-not $notified) {
    # Fallback: visible terminal output plus bell.
    try {
        [console]::Beep(1200, 150)
    }
    catch {
        # Ignore bell errors on hosts that do not support it.
    }

    Write-Host "[$title] $body"
    Write-Host "[notify.ps1] Native toast not available in current runtime."
    Write-Host "[notify.ps1] Optional: Install-Module BurntToast -Scope CurrentUser"
}
