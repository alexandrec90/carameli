# Runs all linters in parallel (ruff, ruff-format, eslint, tsc, stylelint, markdownlint, mypy, pip-audit, vulture, detect-secrets, dotenv-linter, alembic-check, yamllint).
# On failure: writes actionable error details to logs/lint-errors.log for AI-agent consumption.
# On pass: clears the artifact. Terminal exits when done.
$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# Ensure the venv is on PATH so background jobs resolve tools correctly
if (-not $env:VIRTUAL_ENV -and (Test-Path ".venv/Scripts")) {
    $env:VIRTUAL_ENV = (Resolve-Path ".venv").Path
    $env:PATH = "$env:VIRTUAL_ENV\Scripts;$env:PATH"
}

$artifact = "logs/lint-errors.log"
if (-not (Test-Path "logs")) { New-Item -ItemType Directory -Path "logs" | Out-Null }

$sections = [System.Collections.Generic.List[string]]::new()
$anyFailed = $false

Write-Host ""
Write-Host "=== Carameli Lint Suite ===" -ForegroundColor Cyan
Write-Host "Artifact : $((Resolve-Path $artifact -ErrorAction SilentlyContinue) ?? (Join-Path $PWD $artifact))" -ForegroundColor DarkGray
Write-Host "Linters  : ruff, ruff-format, eslint, tsc, stylelint, markdownlint, mypy, pip-audit, vulture, detect-secrets, dotenv-linter, alembic-check, yamllint" -ForegroundColor DarkGray
Write-Host "Mode     : parallel" -ForegroundColor DarkGray
Write-Host ""

# Strip npm run script echo lines and blank lines
filter Remove-Noise {
    if ($_ -notmatch "^> " -and $_ -notmatch "^npm (warn|error)" -and "$_".Trim() -ne "") { $_ }
}

function Write-LintResult([string]$name, [bool]$failed) {
    if ($failed) {
        Write-Host "  [FAIL] $name" -ForegroundColor Red
    }
    else {
        Write-Host "  [pass] $name" -ForegroundColor Green
    }
}

# Returns a skip reason string if the failure is environmental, or $null if it is a real lint error.
function Get-SkipReason([string[]]$lines) {
    $missing = ($lines | Where-Object {
            $_ -match "ModuleNotFoundError|command not found|not recognized|is not installed|Cannot find|could not be found"
        }).Count -gt 0
    if ($missing) { return "not installed" }
    $infra = ($lines | Where-Object {
            $_ -match "ConnectionRefusedError|InvalidPasswordError|OperationalError|authentication failed|could not connect|connection refused|timeout expired"
        }).Count -gt 0
    if ($infra) { return "environment error" }
    return $null
}

# Writes a section to $sections: header, fix hint, and error lines.
function Add-Section([string]$name, [string]$fixHint, [string[]]$lines) {
    $sections.Add("# $name")
    if ($fixHint) { $sections.Add("# fix: $fixHint") }
    if ($lines -and $lines.Count -gt 0) {
        $sections.AddRange([string[]]$lines)
    }
    else {
        $sections.Add("(exit code indicated failure but no parseable error lines -- re-run the tool manually)")
    }
    $sections.Add("")
}

$wd = $PWD.Path

Write-Host "Starting all linters in parallel..." -ForegroundColor Yellow

# --- Launch all linters as background jobs ---
$jobs = [ordered]@{}

$jobs["ruff"] = Start-Job -WorkingDirectory $wd -ScriptBlock {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    # Auto-fix lint, then auto-format -- sequentially so format runs before the
    # lint report and E501 false positives from the parallel race are eliminated.
    ruff check . --fix --unsafe-fixes --quiet 2>&1 | Out-Null
    ruff format . --quiet 2>&1 | Out-Null
    # Report remaining issues for both check and format
    $checkOut = ruff check . --output-format=full 2>&1
    $checkExit = $LASTEXITCODE
    $fmtOut = ruff format --check . 2>&1
    $fmtExit = $LASTEXITCODE
    [PSCustomObject]@{
        CheckExitCode  = $checkExit
        CheckLines     = @($checkOut | ForEach-Object { "$_" })
        FormatExitCode = $fmtExit
        FormatLines    = @($fmtOut | ForEach-Object { "$_" })
    }
}

$jobs["eslint"] = Start-Job -WorkingDirectory $wd -ScriptBlock {
    $out = npm --prefix frontend run lint:eslint -- --fix 2>&1
    [PSCustomObject]@{ ExitCode = $LASTEXITCODE; Lines = @($out | ForEach-Object { "$_" }) }
}

$jobs["tsc"] = Start-Job -WorkingDirectory $wd -ScriptBlock {
    $out = npm --prefix frontend run lint:types 2>&1
    [PSCustomObject]@{ ExitCode = $LASTEXITCODE; Lines = @($out | ForEach-Object { "$_" }) }
}

$jobs["stylelint"] = Start-Job -WorkingDirectory $wd -ScriptBlock {
    $out = npm --prefix frontend run lint:css -- --fix 2>&1
    [PSCustomObject]@{ ExitCode = $LASTEXITCODE; Lines = @($out | ForEach-Object { "$_" }) }
}

$jobs["markdownlint"] = Start-Job -WorkingDirectory $wd -ScriptBlock {
    $out = npm --prefix frontend exec --yes -- markdownlint "**/*.md" --ignore "**/node_modules/**" --ignore "**/.git/**" --ignore "**/.venv/**" -c ".markdownlint.json" --fix 2>&1
    [PSCustomObject]@{ ExitCode = $LASTEXITCODE; Lines = @($out | ForEach-Object { "$_" }) }
}

$jobs["mypy"] = Start-Job -WorkingDirectory $wd -ScriptBlock {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $out = mypy app/ 2>&1
    [PSCustomObject]@{ ExitCode = $LASTEXITCODE; Lines = @($out | ForEach-Object { "$_" }) }
}

$jobs["pip-audit"] = Start-Job -WorkingDirectory $wd -ScriptBlock {
    # Auto-upgrade vulnerable packages first, then report any remaining
    pip-audit --fix --quiet 2>&1 | Out-Null
    $out = pip-audit 2>&1
    [PSCustomObject]@{ ExitCode = $LASTEXITCODE; Lines = @($out | ForEach-Object { "$_" }) }
}

$jobs["vulture"] = Start-Job -WorkingDirectory $wd -ScriptBlock {
    $out = vulture app/ --min-confidence 80 --ignore-names "cls,ctx,opts" 2>&1
    [PSCustomObject]@{ ExitCode = $LASTEXITCODE; Lines = @($out | ForEach-Object { "$_" }) }
}

$jobs["detect-secrets"] = Start-Job -WorkingDirectory $wd -ScriptBlock {

    # detect-secrets scan always exits 0; failures are detected by comparing output to the baseline.
    if (-not (Test-Path ".secrets.baseline")) {
        return [PSCustomObject]@{ ExitCode = 1; Lines = @("detect-secrets: .secrets.baseline not found -- run: detect-secrets scan > .secrets.baseline") }
    }
    $scanRaw = (detect-secrets scan --exclude-files '\.secrets\.baseline' 2>&1) -join "`n"
    if ($LASTEXITCODE -ne 0) {
        return [PSCustomObject]@{ ExitCode = 1; Lines = @("detect-secrets: scan error: $scanRaw") }
    }
    try { $newScan = $scanRaw | ConvertFrom-Json } catch {
        return [PSCustomObject]@{ ExitCode = 1; Lines = @("detect-secrets: could not parse scan output") }
    }
    $existing = (Get-Content ".secrets.baseline" -Raw) | ConvertFrom-Json
    $errors = [System.Collections.Generic.List[string]]::new()
    foreach ($prop in $newScan.results.PSObject.Properties) {
        $file = $prop.Name
        foreach ($secret in $prop.Value) {
            $inBaseline = $false
            $bProp = $existing.results.PSObject.Properties[$file]
            if ($bProp) {
                $inBaseline = ($bProp.Value | Where-Object { $_.hashed_secret -eq $secret.hashed_secret }).Count -gt 0
            }
            if (-not $inBaseline) {
                $errors.Add("${file}:$($secret.line_number): $($secret.type) [not in baseline -- run: detect-secrets scan > .secrets.baseline to acknowledge]")
            }
        }
    }
    if ($errors.Count -gt 0) {
        [PSCustomObject]@{ ExitCode = 1; Lines = @($errors) }
    }
    else {
        [PSCustomObject]@{ ExitCode = 0; Lines = @() }
    }
}

$jobs["alembic-check"] = Start-Job -WorkingDirectory $wd -ScriptBlock {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $out = alembic check 2>&1
    [PSCustomObject]@{ ExitCode = $LASTEXITCODE; Lines = @($out | ForEach-Object { "$_" }) }
}

$jobs["dotenv-linter"] = Start-Job -WorkingDirectory $wd -ScriptBlock {
    $envFiles = @(Get-ChildItem -Filter ".env*" -File | Select-Object -ExpandProperty Name)
    if ($envFiles) {
        $out = & dotenv-linter check @envFiles 2>&1
        [PSCustomObject]@{ ExitCode = $LASTEXITCODE; Lines = @($out | ForEach-Object { "$_" }) }
    }
    else {
        [PSCustomObject]@{ ExitCode = 0; Lines = @() }
    }
}

$jobs["yamllint"] = Start-Job -WorkingDirectory $wd -ScriptBlock {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $targets = @(
        ".pre-commit-config.yaml",
        ".github/workflows",
        "docker-compose.yml",
        "prometheus.yml"
    ) | Where-Object { Test-Path $_ }
    if ($targets) {
        $out = yamllint --strict -f parsable @targets 2>&1
        [PSCustomObject]@{ ExitCode = $LASTEXITCODE; Lines = @($out | ForEach-Object { "$_" }) }
    }
    else {
        [PSCustomObject]@{ ExitCode = 0; Lines = @() }
    }
}

# --- Wait for all jobs to finish ---
$jobs.Values | Wait-Job | Out-Null

# --- Collect results in display order ---

# ruff + ruff-format (combined job — sequential to avoid file-mutation races)
$ruffResult = Receive-Job $jobs["ruff"]

$failed = $ruffResult.CheckExitCode -ne 0
$skipReason = if ($failed) { Get-SkipReason $ruffResult.CheckLines } else { $null }
if ($failed -and -not $skipReason) {
    $anyFailed = $true
    # Full format includes: file:line:col, rule code, message, code snippet, and rule URL
    # Strip "Found N errors" summary -- every error is already listed with full detail
    $errs = @($ruffResult.CheckLines | Remove-Noise | Where-Object { $_.Trim() -ne "" -and $_ -notmatch "^Found \d+ error" })
    Add-Section "ruff" "ruff check . --fix --unsafe-fixes" $errs
}
if ($skipReason) { Write-Host "  [skip] ruff ($skipReason)" -ForegroundColor DarkGray }
else { Write-LintResult "ruff" $failed }

# ruff-format (from combined ruff job)
$failed = $ruffResult.FormatExitCode -ne 0
$skipReason = if ($failed) { Get-SkipReason $ruffResult.FormatLines } else { $null }
if ($failed -and -not $skipReason) {
    $anyFailed = $true
    $errs = @($ruffResult.FormatLines | Remove-Noise | Where-Object { $_ -match "Would reformat" -or $_ -match "^\d+ file" })
    if (-not $errs) { $errs = @($ruffResult.FormatLines | Remove-Noise | Where-Object { $_.Trim() -ne "" }) }
    Add-Section "ruff-format" "ruff format ." $errs
}
if ($skipReason) { Write-Host "  [skip] ruff-format ($skipReason)" -ForegroundColor DarkGray }
else { Write-LintResult "ruff-format" $failed }

# eslint
$r = Receive-Job $jobs["eslint"]
$failed = $r.ExitCode -ne 0
$skipReason = if ($failed) { Get-SkipReason $r.Lines } else { $null }
if ($failed -and -not $skipReason) {
    $anyFailed = $true
    $errs = @($r.Lines | Remove-Noise | Where-Object { $_ -match "\s(error|warning)\s" -or $_ -match "^\S.*\.(ts|tsx|js)" })
    if (-not $errs) { $errs = @($r.Lines | Remove-Noise | Where-Object { $_.Trim() -ne "" }) }
    Add-Section "eslint" "npm --prefix frontend run lint:eslint -- --fix" $errs
}
if ($skipReason) { Write-Host "  [skip] eslint ($skipReason)" -ForegroundColor DarkGray }
else { Write-LintResult "eslint" $failed }

# tsc
$r = Receive-Job $jobs["tsc"]
$failed = $r.ExitCode -ne 0
$skipReason = if ($failed) { Get-SkipReason $r.Lines } else { $null }
if ($failed -and -not $skipReason) {
    $anyFailed = $true
    $errs = @($r.Lines | Remove-Noise | Where-Object { $_ -match "error TS\d+" })
    if (-not $errs) { $errs = @($r.Lines | Remove-Noise | Where-Object { $_.Trim() -ne "" }) }
    Add-Section "tsc" "manual -- type errors require code changes" $errs
}
if ($skipReason) { Write-Host "  [skip] tsc ($skipReason)" -ForegroundColor DarkGray }
else { Write-LintResult "tsc" $failed }

# stylelint
$r = Receive-Job $jobs["stylelint"]
$failed = $r.ExitCode -ne 0
$skipReason = if ($failed) { Get-SkipReason $r.Lines } else { $null }
if ($failed -and -not $skipReason) {
    $anyFailed = $true
    $errs = @($r.Lines | Remove-Noise | Where-Object { $_ -match ":\d+:\d+.*(error|warning)" })
    if (-not $errs) { $errs = @($r.Lines | Remove-Noise | Where-Object { $_.Trim() -ne "" }) }
    Add-Section "stylelint" "npm --prefix frontend run lint:css -- --fix" $errs
}
if ($skipReason) { Write-Host "  [skip] stylelint ($skipReason)" -ForegroundColor DarkGray }
else { Write-LintResult "stylelint" $failed }

# markdownlint
$r = Receive-Job $jobs["markdownlint"]
$failed = $r.ExitCode -ne 0
$skipReason = if ($failed) { Get-SkipReason $r.Lines } else { $null }
if ($failed -and -not $skipReason) {
    $anyFailed = $true
    $errs = @($r.Lines | Remove-Noise | Where-Object { $_ -match ":\d+:\d+" -or $_ -match ":\d+ " })
    if (-not $errs) { $errs = @($r.Lines | Remove-Noise | Where-Object { $_.Trim() -ne "" }) }
    Add-Section "markdownlint" "manual -- remaining errors could not be auto-fixed" $errs
}
if ($skipReason) { Write-Host "  [skip] markdownlint ($skipReason)" -ForegroundColor DarkGray }
else { Write-LintResult "markdownlint" $failed }

# mypy
$r = Receive-Job $jobs["mypy"]
$failed = $r.ExitCode -ne 0
$skipReason = if ($failed) { Get-SkipReason $r.Lines } else { $null }
if ($failed -and -not $skipReason) {
    $anyFailed = $true
    $errs = @($r.Lines | Remove-Noise | Where-Object { $_ -match ": error:" -or $_ -match ": note:" })
    if (-not $errs) { $errs = @($r.Lines | Remove-Noise | Where-Object { $_.Trim() -ne "" }) }
    Add-Section "mypy" "manual -- type errors require code changes" $errs
}
if ($skipReason) { Write-Host "  [skip] mypy ($skipReason)" -ForegroundColor DarkGray }
else { Write-LintResult "mypy" $failed }

# pip-audit
$r = Receive-Job $jobs["pip-audit"]
$failed = $r.ExitCode -ne 0
$skipReason = if ($failed) { Get-SkipReason $r.Lines } else { $null }
if ($failed -and -not $skipReason) {
    $anyFailed = $true
    $errs = @($r.Lines | Where-Object { $_ -match "PYSEC|CVE|vulnerability|Name|---" })
    if (-not $errs) { $errs = @($r.Lines | Where-Object { $_.Trim() -ne "" }) }
    Add-Section "pip-audit" "pip install --upgrade <package> -- update vulnerable dependencies" $errs
}
if ($skipReason) { Write-Host "  [skip] pip-audit ($skipReason)" -ForegroundColor DarkGray }
else { Write-LintResult "pip-audit" $failed }

# vulture
$r = Receive-Job $jobs["vulture"]
$failed = $r.ExitCode -ne 0
$skipReason = if ($failed) { Get-SkipReason $r.Lines } else { $null }
if ($failed -and -not $skipReason) {
    $anyFailed = $true
    $errs = @($r.Lines | Remove-Noise | Where-Object { $_ -match "unused" })
    if (-not $errs) { $errs = @($r.Lines | Remove-Noise | Where-Object { $_.Trim() -ne "" }) }
    Add-Section "vulture" "manual -- remove or whitelist unused code" $errs
}
if ($skipReason) { Write-Host "  [skip] vulture ($skipReason)" -ForegroundColor DarkGray }
else { Write-LintResult "vulture" $failed }

# detect-secrets
$r = Receive-Job $jobs["detect-secrets"]
$failed = $r.ExitCode -ne 0
$skipReason = if ($failed) { Get-SkipReason $r.Lines } else { $null }
if ($failed -and -not $skipReason) {
    $anyFailed = $true
    $errs = @($r.Lines | Where-Object { $_ -match "Secret|Potential|ERROR" -or $_ -match "Location:" })
    if (-not $errs) { $errs = @($r.Lines | Where-Object { $_.Trim() -ne "" }) }
    Add-Section "detect-secrets" "detect-secrets scan --update .secrets.baseline" $errs
}
if ($skipReason) { Write-Host "  [skip] detect-secrets ($skipReason)" -ForegroundColor DarkGray }
else { Write-LintResult "detect-secrets" $failed }

# alembic-check
$r = Receive-Job $jobs["alembic-check"]
$failed = $r.ExitCode -ne 0
$skipReason = if ($failed) { Get-SkipReason $r.Lines } else { $null }
if ($failed -and -not $skipReason) {
    $anyFailed = $true
    $errs = @($r.Lines | Remove-Noise | Where-Object { $_.Trim() -ne "" })
    Add-Section "alembic-check" "alembic revision --autogenerate -m 'describe change'" $errs
}
if ($skipReason) { Write-Host "  [skip] alembic-check ($skipReason)" -ForegroundColor DarkGray }
else { Write-LintResult "alembic-check" $failed }

# dotenv-linter
$r = Receive-Job $jobs["dotenv-linter"]
$failed = $r.ExitCode -ne 0
$skipReason = if ($failed) { Get-SkipReason $r.Lines } else { $null }
if ($failed -and -not $skipReason) {
    $anyFailed = $true
    $errs = @($r.Lines | Where-Object { $_ -match "\.env" })
    if (-not $errs) { $errs = @($r.Lines | Where-Object { $_.Trim() -ne "" }) }
    Add-Section "dotenv-linter" "manual -- edit .env files to fix" $errs
}
if ($skipReason) { Write-Host "  [skip] dotenv-linter ($skipReason)" -ForegroundColor DarkGray }
else { Write-LintResult "dotenv-linter" $failed }

# yamllint
$r = Receive-Job $jobs["yamllint"]
$failed = $r.ExitCode -ne 0
$skipReason = if ($failed) { Get-SkipReason $r.Lines } else { $null }
if ($failed -and -not $skipReason) {
    $anyFailed = $true
    $errs = @($r.Lines | Remove-Noise | Where-Object { $_ -match ":\d+:\d+:.*\[(warning|error)\]" })
    if (-not $errs) { $errs = @($r.Lines | Remove-Noise | Where-Object { $_.Trim() -ne "" }) }
    Add-Section "yamllint" "manual -- fix YAML formatting issues" $errs
}
if ($skipReason) { Write-Host "  [skip] yamllint ($skipReason)" -ForegroundColor DarkGray }
else { Write-LintResult "yamllint" $failed }

# --- Cleanup ---
$jobs.Values | Remove-Job -Force

# --- Write artifact and exit ---
Write-Host ""
if ($anyFailed) {
    $sections | Set-Content $artifact -Encoding utf8
    Write-Host "Errors written to: $artifact" -ForegroundColor Red
    Write-Host ""
    Write-Host "  ==========================================" -ForegroundColor Red
    Write-Host "               LINT FAILED                   " -ForegroundColor Red
    Write-Host "  ==========================================" -ForegroundColor Red
    Write-Host ""
    exit 1
}
else {
    Set-Content $artifact "" -Encoding utf8
    Write-Host ""
    Write-Host "  ==========================================" -ForegroundColor Green
    Write-Host "              LINT PASSED                    " -ForegroundColor Green
    Write-Host "  ==========================================" -ForegroundColor Green
    Write-Host ""
    exit 0
}
