# Runs all linters in parallel (ruff, eslint, tsc, stylelint, markdownlint, bandit).
# On failure: writes only error lines to logs/lint-errors.log.
# On pass: clears the artifact. Terminal exits when done.
$ErrorActionPreference = "Continue"

$artifact = "logs/lint-errors.log"
if (-not (Test-Path "logs")) { New-Item -ItemType Directory -Path "logs" | Out-Null }

$sections = [System.Collections.Generic.List[string]]::new()
$anyFailed = $false

Write-Host ""
Write-Host "=== Carameli Lint Suite ===" -ForegroundColor Cyan
Write-Host "Artifact : $((Resolve-Path $artifact -ErrorAction SilentlyContinue) ?? (Join-Path $PWD $artifact))" -ForegroundColor DarkGray
Write-Host "Linters  : ruff, eslint, tsc, stylelint, markdownlint, bandit" -ForegroundColor DarkGray
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

$wd = $PWD.Path

Write-Host "Starting all linters in parallel..." -ForegroundColor Yellow

# --- Launch all linters as background jobs ---
$jobs = [ordered]@{}

$jobs["ruff"] = Start-Job -WorkingDirectory $wd -ScriptBlock {
    $out = ruff check . --fix 2>&1
    [PSCustomObject]@{ ExitCode = $LASTEXITCODE; Lines = @($out | ForEach-Object { "$_" }) }
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

$jobs["bandit"] = Start-Job -WorkingDirectory $wd -ScriptBlock {
    $out = bandit -r app/ -ll -q 2>&1
    [PSCustomObject]@{ ExitCode = $LASTEXITCODE; Lines = @($out | ForEach-Object { "$_" }) }
}

# --- Wait for all jobs to finish ---
$jobs.Values | Wait-Job | Out-Null

# --- Collect results in display order ---

# ruff
$r = Receive-Job $jobs["ruff"]
$failed = $r.ExitCode -ne 0
if ($failed) {
    $anyFailed = $true
    $errs = @($r.Lines | Remove-Noise | Where-Object { $_ -match ":\d+:\d+:" -or $_ -match "^Found \d+ error" })
    $sections.Add("# ruff")
    if ($errs) { $sections.AddRange([string[]]$errs) } else { $sections.AddRange([string[]]@($r.Lines | Where-Object { $_.Trim() -ne "" })) }
}
Write-LintResult "ruff" $failed

# eslint
$r = Receive-Job $jobs["eslint"]
$failed = $r.ExitCode -ne 0
if ($failed) {
    $anyFailed = $true
    $errs = @($r.Lines | Remove-Noise | Where-Object { $_ -match "\s(error|warning)\s" -or $_ -match "^\S.*\.(ts|tsx|js)" })
    $sections.Add("# eslint")
    if ($errs) { $sections.AddRange([string[]]$errs) } else { $sections.AddRange([string[]]@($r.Lines | Where-Object { $_.Trim() -ne "" })) }
}
Write-LintResult "eslint" $failed

# tsc
$r = Receive-Job $jobs["tsc"]
$failed = $r.ExitCode -ne 0
if ($failed) {
    $anyFailed = $true
    $errs = @($r.Lines | Remove-Noise | Where-Object { $_ -match "error TS\d+" })
    $sections.Add("# tsc")
    if ($errs) { $sections.AddRange([string[]]$errs) } else { $sections.AddRange([string[]]@($r.Lines | Where-Object { $_.Trim() -ne "" })) }
}
Write-LintResult "tsc" $failed

# stylelint
$r = Receive-Job $jobs["stylelint"]
$failed = $r.ExitCode -ne 0
if ($failed) {
    $anyFailed = $true
    $errs = @($r.Lines | Remove-Noise | Where-Object { $_ -match ":\d+:\d+.*(error|warning)" })
    $sections.Add("# stylelint")
    if ($errs) { $sections.AddRange([string[]]$errs) } else { $sections.AddRange([string[]]@($r.Lines | Where-Object { $_.Trim() -ne "" })) }
}
Write-LintResult "stylelint" $failed

# markdownlint
$r = Receive-Job $jobs["markdownlint"]
$failed = $r.ExitCode -ne 0
if ($failed) {
    $anyFailed = $true
    $errs = @($r.Lines | Remove-Noise | Where-Object { $_ -match ":\d+:\d+" })
    $sections.Add("# markdownlint")
    if ($errs) { $sections.AddRange([string[]]$errs) } else { $sections.AddRange([string[]]@($r.Lines | Where-Object { $_.Trim() -ne "" })) }
}
Write-LintResult "markdownlint" $failed

# bandit
$r = Receive-Job $jobs["bandit"]
$failed = $r.ExitCode -ne 0
if ($failed) {
    $anyFailed = $true
    $errs = @($r.Lines | Where-Object { $_ -match "^>> Issue:|^\s+Location:|Severity:|Confidence:" })
    $sections.Add("# bandit")
    if ($errs) { $sections.AddRange([string[]]$errs) } else { $sections.AddRange([string[]]@($r.Lines | Where-Object { $_.Trim() -ne "" })) }
}
Write-LintResult "bandit" $failed

# --- Cleanup ---
$jobs.Values | Remove-Job -Force

# --- Write artifact and exit ---
Write-Host ""
if ($anyFailed) {
    $sections | Set-Content $artifact
    Write-Host "Errors written to: $artifact" -ForegroundColor Red
    Write-Host ""
    Write-Host "  ==========================================" -ForegroundColor Red
    Write-Host "               LINT FAILED                   " -ForegroundColor Red
    Write-Host "  ==========================================" -ForegroundColor Red
    Write-Host ""
    exit 1
}
else {
    Set-Content $artifact ""
    Write-Host ""
    Write-Host "  ==========================================" -ForegroundColor Green
    Write-Host "              LINT PASSED                    " -ForegroundColor Green
    Write-Host "  ==========================================" -ForegroundColor Green
    Write-Host ""
    exit 0
}
