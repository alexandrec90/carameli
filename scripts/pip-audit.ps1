# Runs pip-audit inside the running app container to scan installed packages
# against the OSV database for known CVEs.
$ErrorActionPreference = "Stop"

Write-Host "Running pip-audit vulnerability scan..."
# --ignore-vuln: suppress CVEs with no upstream fix yet (transitive deps)
docker compose exec app pip-audit --ignore-vuln CVE-2026-4539
