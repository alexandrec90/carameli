# Runs mypy static type checker against the app/ package inside the Docker container.
$ErrorActionPreference = "Stop"

Write-Host "Running mypy type check on app/..."
docker compose exec app mypy app/
