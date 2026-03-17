# Runs ruff linter against the app/ package inside the Docker container.
$ErrorActionPreference = "Stop"

Write-Host "Running ruff check on app/..."
docker compose exec app ruff check app/
