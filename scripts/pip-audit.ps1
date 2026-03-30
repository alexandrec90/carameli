# Runs pip-audit inside the running app container to scan installed packages
# against the OSV database for known CVEs.
$ErrorActionPreference = "Stop"

Write-Host "Running pip-audit auto-fix pass..."
# --fix: upgrade vulnerable packages in the running container before reporting
docker compose exec -T app pip-audit --fix --ignore-vuln CVE-2026-4539

Write-Host "Running pip-audit vulnerability scan..."
# --ignore-vuln: suppress CVEs with no upstream fix yet (transitive deps)
docker compose exec -T app pip-audit --ignore-vuln CVE-2026-4539
