# Track E — CI Wiring

Two sequential sessions. Start E1 after Track A (unit tests are green). Start E2 after
Tracks A, B, C, and D are complete.

---

## Context

The project already has `scripts/run-ci.ps1` — a local PowerShell CI orchestrator.
The goal of this track is to wire the test tiers into automated pipelines:

- **E1** → Tier 1 (PR gate): fast, deterministic, no external deps
- **E2** → Tier 2 (nightly) + Tier 3 (weekly) + reporting infrastructure

Read `scripts/run-ci.ps1` in full before making any changes.

---

## Session E0 — Shared infrastructure (do this before E1 or E2)

These changes are prerequisites for both sessions. Complete them first.

### Step 0a — Update `pytest.ini`

The current file has one marker (`slow`) and ignores `tests/e2e`. Replace `addopts` and
`markers` with the full set needed by the new test tracks:

```ini
[pytest]
asyncio_mode = auto
asyncio_default_fixture_loop_scope = session
testpaths = tests
import_mode = importlib
addopts = --ignore=tests/e2e --ignore=tests/load --ignore=tests/quarantine
markers =
    slow: Tests that are slow (migration round-trips etc.) -- run with -m slow
    chargeable: Tests that may incur real or sandbox provider charges
    sandbox: Tests that require live sandbox credentials (TELNYX_SANDBOX=1)
```

`--ignore=tests/quarantine` must be present before the quarantine directory exists — pytest
will silently skip a non-existent path in `--ignore`, so there is no risk of error.

### Step 0b — Add five tasks to `.vscode/tasks.json`

Insert these five objects into the `"tasks"` array, after the existing
`"Test: Run E2E (headed)"` entry. Follow the project convention exactly:

> **Superseded:** the JSON below predates the notify-wrap migration. Notifications now
> use a Python wrapper, not `notify.ps1`. The current convention is a `"type": "process"`
> task: `python scripts/notify-wrap.py "<Label>" -- <command> [args...]`. See
> `.claude/rules/tooling.md` and the live `.vscode/tasks.json` for the canonical form.

- `"type": "process"` wrapping the command with `scripts/notify-wrap.py`
- `"group": "test"` on all five
- `"panel": "shared"` for quick tasks, `"panel": "new"` for long-running ones
- `"close": false` on all

```jsonc
{
  "label": "Test: Run pytest (slow)",
  "type": "shell",
  "command": "docker compose exec -T app pytest -m slow -v --tb=short; $_ec = $LASTEXITCODE; pwsh -ExecutionPolicy Bypass -File scripts/notify.ps1 -Label 'Test: Run pytest (slow)' -ExitCode $_ec; exit $_ec",
  "group": "test",
  "presentation": {
    "reveal": "always",
    "panel": "shared",
    "showReuseMessage": false,
    "close": false
  },
  "problemMatcher": []
},
{
  "label": "Test: Run Telnyx Sandbox",
  "type": "shell",
  "command": "docker compose exec -T -e TELNYX_SANDBOX=1 app pytest tests/integration/test_telnyx_sandbox.py -v --tb=short; $_ec = $LASTEXITCODE; pwsh -ExecutionPolicy Bypass -File scripts/notify.ps1 -Label 'Test: Run Telnyx Sandbox' -ExitCode $_ec; exit $_ec",
  "group": "test",
  "presentation": {
    "reveal": "always",
    "panel": "shared",
    "showReuseMessage": false,
    "close": false
  },
  "problemMatcher": []
},
{
  "label": "Test: Run E2E (cross-browser)",
  "type": "shell",
  "command": "pwsh -ExecutionPolicy Bypass -File scripts/run-e2e.ps1 -CrossBrowser; $_ec = $LASTEXITCODE; pwsh -ExecutionPolicy Bypass -File scripts/notify.ps1 -Label 'Test: Run E2E (cross-browser)' -ExitCode $_ec; exit $_ec",
  "group": "test",
  "presentation": {
    "reveal": "always",
    "panel": "new",
    "showReuseMessage": false,
    "close": false
  },
  "problemMatcher": []
},
{
  "label": "Test: Run Load (Locust)",
  "type": "shell",
  "command": "pwsh -ExecutionPolicy Bypass -File scripts/run-load.ps1; $_ec = $LASTEXITCODE; pwsh -ExecutionPolicy Bypass -File scripts/notify.ps1 -Label 'Test: Run Load (Locust)' -ExitCode $_ec; exit $_ec",
  "group": "test",
  "presentation": {
    "reveal": "always",
    "panel": "new",
    "showReuseMessage": false,
    "close": false
  },
  "problemMatcher": []
},
{
  "label": "Test: Run Mutation (mutmut)",
  "type": "shell",
  "command": "pwsh -ExecutionPolicy Bypass -File scripts/run-mutation.ps1; $_ec = $LASTEXITCODE; pwsh -ExecutionPolicy Bypass -File scripts/notify.ps1 -Label 'Test: Run Mutation (mutmut)' -ExitCode $_ec; exit $_ec",
  "group": "test",
  "presentation": {
    "reveal": "always",
    "panel": "new",
    "showReuseMessage": false,
    "close": false
  },
  "problemMatcher": []
}
```

### Step 0c — Extend `scripts/run-e2e.ps1` with `-CrossBrowser` switch

Read `scripts/run-e2e.ps1` in full first. Add a `[switch]$CrossBrowser` parameter and a
branch that passes all three browser flags to pytest:

```powershell
param(
    [switch]$Headed,
    [switch]$CrossBrowser
)

if ($CrossBrowser) {
    docker compose exec -T app pytest tests/e2e/ `
        --browser=chromium --browser=firefox --browser=webkit `
        -v --tb=short
} elseif ($Headed) {
    # existing headed branch — leave as-is
} else {
    # existing headless branch — leave as-is
}
```

Preserve whatever is already in the `$Headed` and default branches — only add the new
`$CrossBrowser` branch on top.

### Step 0d — Create `scripts/run-load.ps1`

Locust runs on the **host** (not inside the container) against `http://localhost:8000`.
`locust` must be installed in the project `.venv`:

```powershell
# scripts/run-load.ps1
param(
    [int]$Users = 10,
    [string]$SpawnRate = "2",
    [string]$RunTime = "1m",
    [string]$Host = "http://localhost:8000"
)

$ReportDir = "reports"
if (-not (Test-Path $ReportDir)) { New-Item -ItemType Directory -Path $ReportDir | Out-Null }

& ".venv\Scripts\locust.exe" `
    -f tests/load/locustfile.py `
    --headless `
    -u $Users `
    -r $SpawnRate `
    --run-time $RunTime `
    --host $Host `
    --html "$ReportDir\load-report.html" `
    --csv "$ReportDir\load"

exit $LASTEXITCODE
```

Add `locust` to `requirements-dev.txt` if it is not already there.

### Step 0e — Create `scripts/run-mutation.ps1`

`mutmut` mutates source files on the host and invokes pytest inside the container as the
test runner. This means `mutmut` runs from the host `.venv`, but its `runner` command is
`docker compose exec -T app pytest`.

First, ensure `setup.cfg` (or the `[tool.mutmut]` section of `pyproject.toml`) contains the
configuration described in `docs/plans/active/test-coverage/track-d-tooling.md` Session D4, with:

```ini
runner = docker compose exec -T app pytest tests/unit/ -x -q
```

Then create the script:

```powershell
# scripts/run-mutation.ps1
$ReportDir = "reports"
if (-not (Test-Path $ReportDir)) { New-Item -ItemType Directory -Path $ReportDir | Out-Null }

& ".venv\Scripts\mutmut.exe" run
$RunExit = $LASTEXITCODE

& ".venv\Scripts\mutmut.exe" results | Tee-Object -FilePath "$ReportDir\mutation-report.txt"

# Exit 0 even if mutants survived — surviving mutants are informational, not a hard failure
# Change to `exit $RunExit` once the score target (>80%) is met
exit 0
```

Add `mutmut` to `requirements-dev.txt` if it is not already there.

### Step 0f — Create `tests/quarantine/` with a `.gitkeep`

```powershell
New-Item -ItemType Directory -Path tests/quarantine -Force | Out-Null
New-Item -ItemType File -Path tests/quarantine/.gitkeep | Out-Null
```

Add a `tests/quarantine/__init__.py` so pytest does not error if the directory ever contains
a test file that imports from the project.

---

## Session E1 — Tier 1 PR gate

### What Tier 1 must run

Per `docs/plans/active/test-implementation-checklist.md` §3 Tier 1:

- All backend unit tests (`tests/unit/`)
- Selected integration tests (critical path subset — `test_full_flows.py`, `test_contract.py`)
- Frontend unit test suite (`cd frontend && npm run test:run`)
- E2E smoke on Chromium only (`tests/e2e/test_smoke.py`)
- Rate-limit tests (included in `tests/unit/test_limiter.py`)
- Frontend log endpoint unit tests (included in `tests/unit/test_frontend_logs.py`)
- Contract/security smoke: `tests/integration/test_contract.py`

Runtime budget: **under 5 minutes total** on the CI runner.

### Step 1 — Update `scripts/run-ci.ps1`

Read the file. Add or verify the following stages run in order:

```powershell
# Stage 1: backend unit + critical integration
Write-Host "=== Stage 1: Backend tests ==="
docker compose exec -T app pytest tests/unit/ tests/integration/test_full_flows.py tests/integration/test_contract.py -x -q --tb=short
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Stage 2: frontend unit tests
Write-Host "=== Stage 2: Frontend unit tests ==="
Set-Location frontend
npm run test:run
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Set-Location ..

# Stage 3: E2E smoke (single browser, requires localhost:5173 running)
Write-Host "=== Stage 3: E2E smoke ==="
pytest tests/e2e/test_smoke.py --browser=chromium -q
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "=== All Tier 1 checks passed ==="
```

Make the E2E stage conditional: skip if the frontend dev server is not reachable on `:5173`.
Use a simple `curl -s http://localhost:5173 > /dev/null` pre-check.

### Step 2 — GitHub Actions workflow: `pr-gate.yml`

Create `.github/workflows/pr-gate.yml`:

```yaml
name: PR Gate

on:
  pull_request:
    branches: [master]
  push:
    branches: [master]

jobs:
  backend:
    name: Backend unit + integration
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:18
        env:
          POSTGRES_USER: carameli
          POSTGRES_PASSWORD: carameli_local_dev
          POSTGRES_DB: carameli
        ports: ["5432:5432"]
        options: >-
          --health-cmd="pg_isready -U carameli"
          --health-interval=5s
          --health-timeout=5s
          --health-retries=10
      redis:
        image: redis:7-alpine
        ports: ["6379:6379"]
    env:
      DATABASE_URL: postgresql+asyncpg://carameli:carameli_local_dev@localhost:5432/carameli # pragma: allowlist secret
      REDIS_URL: redis://localhost:6379
      API_KEY_SECRET: ci-test-key # pragma: allowlist secret
      SESSION_SECRET: ci-session-secret # pragma: allowlist secret
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
          cache: pip
      - run: pip install -r requirements.txt -r requirements-dev.txt
      - name: Run backend unit tests
        run: pytest tests/unit/ -x -q --tb=short --junit-xml=reports/junit-unit.xml
      - name: Run critical integration tests
        run: pytest tests/integration/test_full_flows.py tests/integration/test_contract.py -x -q --tb=short --junit-xml=reports/junit-integration.xml
      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: test-results-backend
          path: reports/

  frontend:
    name: Frontend unit tests
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      - run: npm run test:run
```

### Step 3 — `pytest.ini` configuration

Verify `pytest.ini` has the following:

```ini
[pytest]
asyncio_mode = auto
addopts = --ignore=tests/e2e --ignore=tests/load
markers =
    slow: Tests that are slow (run separately, not in PR gate)
    chargeable: Tests that may incur provider charges
    sandbox: Tests that require live sandbox credentials
```

The `--ignore` lines ensure E2E and load tests are excluded from the default `pytest` invocation
that CI runs.

### Step 4 — Collect test results

Create a `reports/` directory and add it to `.gitignore`:

```bash
mkdir -p reports
echo "reports/" >> .gitignore
```

The `--junit-xml` flag above writes JUnit XML files that GitHub Actions (and most CI tools)
can parse to show per-test pass/fail directly in the PR UI.

### Step 5 — Branch protection rule (document, do not implement)

In the project README or a new `docs/ci-setup.md`, document that the GitHub repository should
have a branch protection rule on `master` that requires the `PR Gate / backend` and
`PR Gate / frontend` jobs to pass before merging.

---

## Session E2 — Nightly + Weekly tiers + reporting

### Nightly workflow: `.github/workflows/nightly.yml`

Runs at 02:00 UTC every day. Includes everything from Tier 2:

```yaml
name: Nightly

on:
  schedule:
    - cron: "0 2 * * *"
  workflow_dispatch:   # allow manual trigger

jobs:
  backend-full:
    name: Full backend suite
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:18
        env:
          POSTGRES_USER: carameli
          POSTGRES_PASSWORD: carameli_local_dev
          POSTGRES_DB: carameli
        ports: ["5432:5432"]
        options: --health-cmd="pg_isready -U carameli" --health-interval=5s --health-retries=10
      redis:
        image: redis:7-alpine
        ports: ["6379:6379"]
    env:
      DATABASE_URL: postgresql+asyncpg://carameli:carameli_local_dev@localhost:5432/carameli # pragma: allowlist secret
      REDIS_URL: redis://localhost:6379
      API_KEY_SECRET: nightly-test-key # pragma: allowlist secret
      SESSION_SECRET: nightly-session-secret # pragma: allowlist secret
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
          cache: pip
      - run: pip install -r requirements.txt -r requirements-dev.txt
      - name: Full unit suite
        run: pytest tests/unit/ -q --tb=short --junit-xml=reports/junit-unit-nightly.xml
      - name: Full integration suite
        run: pytest tests/integration/ -q --tb=short -k "not sandbox" --junit-xml=reports/junit-integration-nightly.xml
      - name: Adversarial webhook tests
        run: pytest tests/unit/test_webhooks.py -q -k "403 or sig or tamper or replay"
      - name: Upload results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: nightly-results
          path: reports/

  frontend-full:
    name: Full frontend suite
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: npm
          cache-dependency-path: frontend/package-lock.json
      - run: npm ci
      - run: npm run test:run -- --reporter=junit --outputFile=../reports/junit-frontend-nightly.xml

  e2e-matrix:
    name: Cross-browser E2E
    runs-on: ubuntu-latest
    needs: [backend-full]
    # Only run if backend passed
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
          cache: pip
      - run: pip install -r requirements.txt -r requirements-dev.txt
      - run: playwright install --with-deps
      - name: Start backend + frontend
        run: |
          docker compose up -d
          # Wait for health
          timeout 60 bash -c 'until curl -sf http://localhost:8000/health; do sleep 2; done'
          cd frontend && npm ci && npm run dev &
          timeout 30 bash -c 'until curl -sf http://localhost:5173; do sleep 2; done'
      - name: Run cross-browser E2E
        run: pytest tests/e2e/ --browser=chromium --browser=firefox --browser=webkit -q
      - name: Upload Playwright traces
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-traces
          path: test-results/
```

### Weekly workflow: `.github/workflows/weekly.yml`

Runs at 03:00 UTC every Sunday. Tier 3 — hardening:

```yaml
name: Weekly Hardening

on:
  schedule:
    - cron: "0 3 * * 0"
  workflow_dispatch:

jobs:
  migration-round-trip:
    name: Migration round-trip + drift detection
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:18
        env:
          POSTGRES_USER: carameli
          POSTGRES_PASSWORD: carameli_local_dev
          POSTGRES_DB: carameli
        ports: ["5432:5432"]
        options: --health-cmd="pg_isready -U carameli" --health-interval=5s --health-retries=10
    env:
      DATABASE_URL: postgresql+asyncpg://carameli:carameli_local_dev@localhost:5432/carameli # pragma: allowlist secret
      API_KEY_SECRET: weekly-test-key # pragma: allowlist secret
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
          cache: pip
      - run: pip install -r requirements.txt -r requirements-dev.txt
      - run: pytest tests/unit/test_migration_concerns.py -v -m slow

  resilience:
    name: Resilience and chaos
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:18
        env:
          POSTGRES_USER: carameli
          POSTGRES_PASSWORD: carameli_local_dev
          POSTGRES_DB: carameli
        ports: ["5432:5432"]
        options: --health-cmd="pg_isready -U carameli" --health-interval=5s --health-retries=10
      redis:
        image: redis:7-alpine
        ports: ["6379:6379"]
    env:
      DATABASE_URL: postgresql+asyncpg://carameli:carameli_local_dev@localhost:5432/carameli # pragma: allowlist secret
      REDIS_URL: redis://localhost:6379
      API_KEY_SECRET: weekly-test-key # pragma: allowlist secret
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
          cache: pip
      - run: pip install -r requirements.txt -r requirements-dev.txt
      - run: pytest tests/integration/test_resilience.py -v

  mutation:
    name: Mutation testing report
    runs-on: ubuntu-latest
    continue-on-error: true  # surviving mutants are not a hard block yet
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
          cache: pip
      - run: pip install -r requirements.txt -r requirements-dev.txt mutmut
      - name: Run mutation tests
        run: mutmut run || true
      - name: Export report
        run: |
          mutmut results > reports/mutation-report.txt
          echo "Mutation score:" >> reports/mutation-report.txt
          mutmut results | tail -5 >> reports/mutation-report.txt
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: mutation-report
          path: reports/mutation-report.txt
```

### Flake quarantine and reporting

Create `tests/quarantine/` for tests that are intermittently flaky and need investigation.
Add to `pytest.ini`:

```ini
addopts = --ignore=tests/e2e --ignore=tests/load --ignore=tests/quarantine
```

Any test moved to quarantine must have a GitHub issue number in a comment above the function:

```python
# Quarantined: flaky under parallel execution — see #42
async def test_flaky_thing(...):
    ...
```

### Weekly reliability report

Add a step to the weekly workflow that posts a summary to a GitHub issue or Slack channel
(using `gh` CLI or a webhook). At minimum, the report should contain:

- Total tests: N passed / N failed / N skipped
- Flake rate: number of tests in `tests/quarantine/`
- Mutation score: from `mutation-report.txt`
- P95 latency baseline: from the most recent load test run (if available)

Example using `gh` CLI:

```bash
gh issue comment <ISSUE_NUMBER> --body "$(cat reports/weekly-summary.md)"
```

Create a pinned GitHub issue titled "Weekly Test Reliability Report" and use its number here.

---

## Verification checklist

After E1:

- [ ] `scripts/run-ci.ps1` runs cleanly on a developer machine with Docker running
- [ ] `.github/workflows/pr-gate.yml` is green on the current `master` branch
- [ ] Branch protection rule is documented in `docs/ci-setup.md`

After E2:

- [ ] Nightly workflow completes without errors (trigger manually with `workflow_dispatch`)
- [ ] Weekly workflow completes without errors
- [ ] `tests/quarantine/` directory exists (even if empty)
- [ ] `docs/evidence/performance-baselines.md` exists (from Track D3)
- [ ] `docs/evidence/mutation-score-baseline.md` exists (from Track D4)
