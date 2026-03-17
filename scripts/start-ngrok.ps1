# Starts ngrok, waits for the tunnel URL, patches .env, and restarts the app container.
$ErrorActionPreference = "Stop"

$EnvFile = Join-Path $PSScriptRoot "..\\.env"

# Kill any existing ngrok process
Get-Process -Name ngrok -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1

# Start ngrok in the background
Write-Host "Starting ngrok..."
Start-Process -FilePath "ngrok" -ArgumentList "http 8000" -WindowStyle Hidden

# Poll the local ngrok API for the public HTTPS URL
$Url = $null
for ($i = 1; $i -le 20; $i++) {
    Start-Sleep -Seconds 1
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:4040/api/tunnels" -ErrorAction SilentlyContinue
        $Url = $response.tunnels | Where-Object { $_.proto -eq "https" } | Select-Object -ExpandProperty public_url -First 1
        if ($Url) { break }
    } catch { }
    Write-Host "Waiting for tunnel... ($i/20)"
}

if (-not $Url) {
    Write-Error "Could not get ngrok URL after 20s. Is ngrok installed and authenticated?"
    exit 1
}

Write-Host "Tunnel URL: $Url"

# Patch .env — update existing line or append
function Patch-Env {
    param($Key, $Val)
    $content = Get-Content $EnvFile -Raw
    if ($content -match "(?m)^${Key}=.*$") {
        $content = $content -replace "(?m)^${Key}=.*$", "${Key}=${Val}"
        Write-Host "Updated ${Key} in .env"
    } else {
        $content = $content.TrimEnd() + "`n${Key}=${Val}`n"
        Write-Host "Added ${Key} to .env"
    }
    Set-Content $EnvFile $content -NoNewline
}

Patch-Env "JAMBONZ_WEBHOOK_BASE_URL" $Url
Patch-Env "TELNYX_WEBHOOK_BASE_URL"  $Url

# Restart the app so it picks up the new env
Write-Host "Restarting app container..."
docker compose restart app

Write-Host ""
Write-Host "Done. Webhook base URL: $Url"
Write-Host "ngrok dashboard: http://localhost:4040"
