# Runs pre-commit hooks on all files.
# On failure: writes only error output to logs/pre-commit-errors.log.
# On pass: clears the artifact. Terminal exits when done.
$ErrorActionPreference = "Continue"

# Ensure the venv is on PATH so language:system hooks resolve tools correctly
if (-not $env:VIRTUAL_ENV -and (Test-Path ".venv/Scripts")) {
    $env:VIRTUAL_ENV = (Resolve-Path ".venv").Path
    $env:PATH = "$env:VIRTUAL_ENV\Scripts;$env:PATH"
}

$artifact = "logs/pre-commit-errors.log"
if (-not (Test-Path "logs")) { New-Item -ItemType Directory -Path "logs" | Out-Null }

Write-Host ""
Write-Host "=== Carameli Pre-Commit Hooks ===" -ForegroundColor Cyan
Write-Host "Artifact : $((Resolve-Path $artifact -ErrorAction SilentlyContinue) ?? (Join-Path $PWD $artifact))" -ForegroundColor DarkGray
Write-Host "Hooks    : detect-secrets, bandit, ruff, ruff-format, dotenv-linter, eslint, stylelint, markdownlint" -ForegroundColor DarkGray
Write-Host ""

Write-Host "Running pre-commit on all files..." -ForegroundColor Yellow
Write-Host ""

$lines = [System.Collections.Generic.List[string]]::new()
$sw = [System.Diagnostics.Stopwatch]::StartNew()

pre-commit run --all-files 2>&1 | ForEach-Object {
    $line = "$_"
    $lines.Add($line)

    # Colorize pass/fail per hook
    switch -Regex ($line) {
        "Passed|passed" {
            Write-Host "  [pass] " -ForegroundColor Green -NoNewline
            Write-Host $line
            break
        }
        "Failed|failed" {
            Write-Host "  [FAIL] " -ForegroundColor Red -NoNewline
            Write-Host $line
            break
        }
        "Skipped|skipped" {
            Write-Host "  [skip] " -ForegroundColor Yellow -NoNewline
            Write-Host $line
            break
        }
        "^[A-Z].*\.\.\." {
            # Hook name line without result yet (e.g. "Detect secrets......")
            Write-Host "  $line"
            break
        }
        default {
            Write-Host "  $line"
        }
    }
}
$exitCode = $LASTEXITCODE
$sw.Stop()
$elapsed = "{0:mm\:ss}" -f $sw.Elapsed

Write-Host ""
if ($exitCode -eq 0) {
    Set-Content $artifact ""
    Write-Host "  [pass] pre-commit ($elapsed)" -ForegroundColor Green
    Write-Host ""
    Write-Host "  ==========================================" -ForegroundColor Green
    Write-Host "          PRE-COMMIT PASSED                  " -ForegroundColor Green
    Write-Host "  ==========================================" -ForegroundColor Green
    Write-Host ""
    exit 0
}

# --- Build structured artifact for coding-agent consumption ---

# Parse raw output into per-hook blocks
$hooks = [ordered]@{}        # hookId -> list of body lines
$currentHook = $null
$hookHeaders = [ordered]@{}  # hookId -> original header line

for ($i = 0; $i -lt $lines.Count; $i++) {
    $l = $lines[$i]

    # Hook result line (e.g. "ruff-format......Failed")
    if ($l -match "^(.+?)\.{3,}.*(Passed|Failed|Skipped)") {
        $hookName = $Matches[1].Trim()
        $result = $Matches[2]
        if ($result -eq "Failed") {
            $currentHook = $hookName
            $hooks[$currentHook] = [System.Collections.Generic.List[string]]::new()
            $hookHeaders[$currentHook] = $l
        }
        else {
            $currentHook = $null
        }
        continue
    }

    if ($null -ne $currentHook -and $l.Trim() -ne "") {
        $hooks[$currentHook].Add($l)
    }
}

if ($hooks.Count -eq 0) {
    # Fallback: write raw output if parsing found nothing
    $lines | Set-Content $artifact
}
else {
    # Capture files modified by auto-fix hooks (ruff --fix, ruff-format)
    $autoFixedFiles = @(git diff --name-only 2>$null)

    # Build display-name -> hook-id map from .pre-commit-config.yaml
    # pre-commit run expects the hook id, not the display name
    $hookNameToId = @{}
    $configLines = Get-Content ".pre-commit-config.yaml" -ErrorAction SilentlyContinue
    $lastId = $null
    foreach ($cl in $configLines) {
        if ($cl -match '^\s+-\s+id:\s+(\S+)') {
            $lastId = $Matches[1].Trim()
        }
        elseif ($cl -match '^\s+name:\s+(.+)$' -and $lastId) {
            $hookNameToId[$Matches[1].Trim()] = $lastId
            $lastId = $null
        }
    }

    # Classify each hook before deciding what to do
    $hookTags = [ordered]@{}
    foreach ($hookId in $hooks.Keys) {
        $body = $hooks[$hookId]
        $isAutoFix = $false
        $isMisconfigured = $false
        foreach ($bl in $body) {
            if ($bl -match "files were modified by this hook") { $isAutoFix = $true }
            if ($bl -match "unrecognized subcommand|unknown option|not found|command not found|No such file") {
                $isMisconfigured = $true
            }
        }
        if ($isMisconfigured) { $hookTags[$hookId] = "misconfigured" }
        elseif ($isAutoFix) { $hookTags[$hookId] = "auto-fixed" }
        else { $hookTags[$hookId] = "error" }
    }

    # If every failure is an auto-fix, stage any real changes and re-run (or
    # treat as pass when the hook is a false positive with nothing to stage).
    $allAutoFixed = ($hookTags.Values | Where-Object { $_ -ne "auto-fixed" }).Count -eq 0
    if ($allAutoFixed) {
        if ($autoFixedFiles.Count -gt 0) {
            # Real auto-fixes on disk -- stage and re-run only the failed hooks
            $failedIds = @($hookTags.Keys)
            Write-Host "  Auto-fixed files detected -- staging and re-running: $($failedIds -join ', ')..." -ForegroundColor Yellow
            foreach ($f in $autoFixedFiles) {
                git add -- $f 2>$null
            }

            $retryAllPassed = $true
            $retryLines = [System.Collections.Generic.List[string]]::new()
            foreach ($hid in $failedIds) {
                $runId = if ($hookNameToId.ContainsKey($hid)) { $hookNameToId[$hid] } else { $hid }
                pre-commit run $runId --all-files 2>&1 | ForEach-Object {
                    $rl = "$_"
                    $retryLines.Add($rl)
                    switch -Regex ($rl) {
                        "Passed|passed" { Write-Host "  [pass] $rl" -ForegroundColor Green; break }
                        "Failed|failed" { Write-Host "  [FAIL] $rl" -ForegroundColor Red; break }
                        "Skipped|skipped" { Write-Host "  [skip] $rl" -ForegroundColor Yellow; break }
                        default { Write-Host "  $rl" }
                    }
                }
                if ($LASTEXITCODE -ne 0) { $retryAllPassed = $false }
            }

            if ($retryAllPassed) {
                $sw.Stop()
                $elapsed = "{0:mm\:ss}" -f $sw.Elapsed
                Set-Content $artifact ""
                Write-Host ""
                Write-Host "  [pass] pre-commit ($elapsed) -- auto-fixed and re-staged" -ForegroundColor Green
                Write-Host ""
                Write-Host "  ==========================================" -ForegroundColor Green
                Write-Host "          PRE-COMMIT PASSED                  " -ForegroundColor Green
                Write-Host "  ==========================================" -ForegroundColor Green
                Write-Host ""
                exit 0
            }
            # Retry still failed -- re-parse retry output so artifact reflects
            # the actual errors, not the stale "auto-fixed" first-run data.
            $hooks = [ordered]@{}
            $hookHeaders = [ordered]@{}
            $currentHook = $null
            for ($ri = 0; $ri -lt $retryLines.Count; $ri++) {
                $rl = $retryLines[$ri]
                if ($rl -match "^(.+?)\.{3,}.*(Passed|Failed|Skipped)") {
                    $hookName = $Matches[1].Trim()
                    $result = $Matches[2]
                    if ($result -eq "Failed") {
                        $currentHook = $hookName
                        $hooks[$currentHook] = [System.Collections.Generic.List[string]]::new()
                        $hookHeaders[$currentHook] = $rl
                    }
                    else { $currentHook = $null }
                    continue
                }
                if ($null -ne $currentHook -and $rl.Trim() -ne "") {
                    $hooks[$currentHook].Add($rl)
                }
            }
            $hookTags = [ordered]@{}
            foreach ($hk in $hooks.Keys) {
                $hookTags[$hk] = "error"
            }
            # fall through to write artifact
        }
        else {
            # Hook reports "files were modified" but git sees no changes --
            # false positive (e.g. pip-audit touching pip cache). Treat as pass.
            $falseHooks = ($hookTags.Keys | ForEach-Object { $_ }) -join ", "
            Write-Host "  No actual file changes from auto-fix hooks ($falseHooks) -- treating as pass" -ForegroundColor Yellow
            $sw.Stop()
            $elapsed = "{0:mm\:ss}" -f $sw.Elapsed
            Set-Content $artifact ""
            Write-Host ""
            Write-Host "  [pass] pre-commit ($elapsed)" -ForegroundColor Green
            Write-Host ""
            Write-Host "  ==========================================" -ForegroundColor Green
            Write-Host "          PRE-COMMIT PASSED                  " -ForegroundColor Green
            Write-Host "  ==========================================" -ForegroundColor Green
            Write-Host ""
            exit 0
        }
    }

    $out = [System.Collections.Generic.List[string]]::new()

    foreach ($hookId in $hooks.Keys) {
        $body = $hooks[$hookId]
        $tag = $hookTags[$hookId]

        $out.Add("## $hookId [$tag]")
        $out.Add("")

        # Add guidance line based on classification
        switch ($tag) {
            "auto-fixed" {
                $out.Add("Files were reformatted by the hook (already fixed on disk).")
                if ($autoFixedFiles.Count -gt 0) {
                    $out.Add("Modified files:")
                    foreach ($f in $autoFixedFiles) {
                        $out.Add("  $f")
                    }
                }
                else {
                    # Include raw body as fallback
                    foreach ($bl in $body) { $out.Add("  $bl") }
                }
                $out.Add("")
                $out.Add("Action: stage the modified files and re-commit.")
            }
            "misconfigured" {
                $out.Add("The hook itself errored (not a source-code issue).")
                $out.Add("Fix target: .pre-commit-config.yaml (entry for ``$hookId``)")
                $out.Add("")
                $out.Add("Hook output:")
                foreach ($bl in $body) { $out.Add("  $bl") }
            }
            default {
                # Real lint/security errors -- keep verbatim for file:line parsing
                foreach ($bl in $body) { $out.Add($bl) }
            }
        }

        $out.Add("")
    }

    $out | Set-Content $artifact
}

Write-Host "  [FAIL] pre-commit ($elapsed)" -ForegroundColor Red
Write-Host ""
Write-Host "Errors written to: $artifact" -ForegroundColor Red
Write-Host ""
Write-Host "  ==========================================" -ForegroundColor Red
Write-Host "          PRE-COMMIT FAILED                  " -ForegroundColor Red
Write-Host "  ==========================================" -ForegroundColor Red
Write-Host ""
exit $exitCode
