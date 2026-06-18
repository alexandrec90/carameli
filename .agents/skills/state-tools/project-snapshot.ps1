[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string[]]$Sections
)

$ErrorActionPreference = 'Stop'

# Normalize: a single comma-joined string (e.g. from -File invocation) becomes an array.
if ($Sections.Count -eq 1 -and $Sections[0] -match ',') {
    $Sections = $Sections[0] -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
Push-Location $repoRoot
try {
    function Show-File {
        param([string]$Label, [string]$Path)
        Write-Output "=== $Label ($Path) ==="
        if (Test-Path $Path) {
            Get-Content -LiteralPath $Path -Raw -ErrorAction SilentlyContinue
        }
        else {
            Write-Output "[FILE NOT FOUND]"
        }
        Write-Output ""
    }

    function Show-Listing {
        param(
            [string]$Label,
            [string]$Path,
            [ValidateSet('directories', 'files', 'all')]
            [string]$Mode = 'all'
        )
        Write-Output "=== $Label ($Path) ==="
        if (Test-Path $Path) {
            $items = switch ($Mode) {
                'directories' { Get-ChildItem -LiteralPath $Path -Directory -ErrorAction SilentlyContinue }
                'files' { Get-ChildItem -LiteralPath $Path -File -ErrorAction SilentlyContinue }
                default { Get-ChildItem -LiteralPath $Path -ErrorAction SilentlyContinue }
            }
            $items | ForEach-Object { $_.Name }
        }
        else {
            Write-Output "[NOT FOUND]"
        }
        Write-Output ""
    }

    foreach ($section in $Sections) {
        switch ($section) {
            'compose'            { Show-File 'docker-compose.yml' 'docker-compose.yml' }
            'requirements'       { Show-File 'requirements.txt' 'requirements.txt' }
            'requirements-dev'   { Show-File 'requirements-dev.txt' 'requirements-dev.txt' }
            'frontend-pkg'       { Show-File 'frontend/package.json' 'frontend/package.json' }
            'config-py'          { Show-File 'app/core/config.py' 'app/core/config.py' }
            'claude-md'          { Show-File 'CLAUDE.md' 'CLAUDE.md' }
            'pre-commit'         { Show-File '.pre-commit-config.yaml' '.pre-commit-config.yaml' }
            'tasks-json'         { Show-File '.vscode/tasks.json' '.vscode/tasks.json' }
            'ruff'               { Show-File 'ruff.toml' 'ruff.toml' }
            'mypy'               { Show-File 'mypy.ini' 'mypy.ini' }
            'pytest'             { Show-File 'pytest.ini' 'pytest.ini' }
            'frontend-eslint'    { Show-File 'frontend/eslint.config.js' 'frontend/eslint.config.js' }
            'frontend-stylelint' { Show-File 'frontend/stylelint.config.cjs' 'frontend/stylelint.config.cjs' }
            'frontend-cspell'    { Show-File 'frontend/cspell.config.yaml' 'frontend/cspell.config.yaml' }
            'frontend-claude-md' { Show-File 'frontend/CLAUDE.md' 'frontend/CLAUDE.md' }
            'tests-claude-md'    { Show-File 'tests/CLAUDE.md' 'tests/CLAUDE.md' }
            'services-claude-md' { Show-File 'app/services/CLAUDE.md' 'app/services/CLAUDE.md' }
            'alembic-env'        { Show-File 'alembic/env.py' 'alembic/env.py' }
            'claudeignore'       { Show-File '.claudeignore' '.claudeignore' }
            'settings-local'     { Show-File '.claude/settings.local.json' '.claude/settings.local.json' }
            'todo'               { Show-File 'todo.md' 'todo.md' }
            'chart-tech-legend'  { Show-File 'charts/tech stack/tech stack legend.md' 'charts/tech stack/tech stack legend.md' }
            'chart-tech-mmd'     { Show-File 'charts/tech stack/tech stack chart.mmd' 'charts/tech stack/tech stack chart.mmd' }
            'chart-meta-legend'  { Show-File 'charts/meta coding/meta coding legend.md' 'charts/meta coding/meta coding legend.md' }
            'chart-meta-mmd'     { Show-File 'charts/meta coding/meta coding chart.mmd' 'charts/meta coding/meta coding chart.mmd' }
            'chart-pricing'      { Show-File 'charts/pricing/pricing table.md' 'charts/pricing/pricing table.md' }
            'chart-skills'       { Show-File 'charts/skills/skills chart.md' 'charts/skills/skills chart.md' }
            'scripts-list'       { Show-Listing 'scripts/' 'scripts' -Mode files }
            'rules-list'         { Show-Listing '.claude/rules/' '.claude/rules' -Mode files }
            'skills-list'        { Show-Listing '.claude/skills/' '.claude/skills' -Mode directories }
            'skills-meta' {
                Write-Output "=== .claude/skills metadata (frontmatter + step count + line count per skill) ==="
                Get-ChildItem -LiteralPath '.claude/skills' -Directory -ErrorAction SilentlyContinue | Sort-Object Name | ForEach-Object {
                    $skillFile = Join-Path $_.FullName 'SKILL.md'
                    if (Test-Path $skillFile) {
                        Write-Output "--- $($_.Name) ---"
                        $content = Get-Content -LiteralPath $skillFile -Raw
                        if ($content -match "(?s)^---\s*\r?\n(.*?)\r?\n---") {
                            Write-Output $matches[1].Trim()
                        }
                        $stepCount = (Select-String -LiteralPath $skillFile -Pattern '^## Step' -AllMatches | Measure-Object).Count
                        $lineCount = (Get-Content -LiteralPath $skillFile | Measure-Object -Line).Lines
                        Write-Output ""
                        Write-Output "STEPS: $stepCount  LINES: $lineCount"
                        Write-Output ""
                    }
                }
                Write-Output ""
            }
            'alembic-count' {
                Write-Output "=== alembic/versions revision count ==="
                if (Test-Path 'alembic/versions') {
                    $count = (Get-ChildItem -LiteralPath 'alembic/versions' -Filter '*.py' -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -notlike '__*' } | Measure-Object).Count
                    Write-Output "Migration revisions: $count"
                }
                else {
                    Write-Output "[NOT FOUND]"
                }
                Write-Output ""
            }
            'provider-modules' {
                Show-Listing 'app/services/providers/carrier/' 'app/services/providers/carrier' -Mode files
                Show-Listing 'app/services/providers/engine/' 'app/services/providers/engine' -Mode files
            }
            default {
                Write-Output "=== UNKNOWN SECTION: $section ==="
                Write-Output ""
            }
        }
    }
    exit 0
}
finally {
    Pop-Location
}
