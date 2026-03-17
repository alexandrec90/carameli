# Runs pre-commit hooks on all files.
# On failure: writes only error output to logs/pre-commit-errors.log.
# On pass: clears the artifact. Terminal exits when done.
$ErrorActionPreference = "Continue"

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
        $result   = $Matches[2]
        if ($result -eq "Failed") {
            $currentHook = $hookName
            $hooks[$currentHook] = [System.Collections.Generic.List[string]]::new()
            $hookHeaders[$currentHook] = $l
        } else {
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
} else {
    # Capture files modified by auto-fix hooks (ruff --fix, ruff-format)
    $autoFixedFiles = @(git diff --name-only 2>$null)

    $out = [System.Collections.Generic.List[string]]::new()

    foreach ($hookId in $hooks.Keys) {
        $body = $hooks[$hookId]

        # Classify the failure
        $isAutoFix = $false
        $isMisconfigured = $false
        foreach ($bl in $body) {
            if ($bl -match "files were modified by this hook") { $isAutoFix = $true }
            if ($bl -match "unrecognized subcommand|unknown option|not found|command not found|No such file") {
                $isMisconfigured = $true
            }
        }

        if ($isMisconfigured) {
            $tag = "misconfigured"
        } elseif ($isAutoFix) {
            $tag = "auto-fixed"
        } else {
            $tag = "error"
        }

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
                } else {
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
