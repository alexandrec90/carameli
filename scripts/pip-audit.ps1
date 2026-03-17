# Runs pip-audit inside the running app container to scan installed packages
# against the OSV database for known CVEs.
$ErrorActionPreference = "Stop"

Write-Host "Running pip-audit vulnerability scan..."
docker compose exec app pip-audit
