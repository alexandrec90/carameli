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

pwsh -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "notify.ps1") -Label "Images: Compress Comic Book" -ExitCode $ec
exit $ec
