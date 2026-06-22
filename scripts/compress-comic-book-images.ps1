$root = Split-Path -Parent $PSScriptRoot
$jsScript = Join-Path $PSScriptRoot "compress-images.js"
$comicBookDir = Join-Path $root "frontend\public\comic-book"

Push-Location (Join-Path $root "frontend")
try {
    node $jsScript $comicBookDir
    $ec = $LASTEXITCODE
} finally {
    Pop-Location
}

# Notifications are a task-layer concern — the VS Code task wraps this script with
# scripts/notify-wrap.py. Do not emit a toast from inside the script.
exit $ec
