[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
Push-Location $repoRoot
try {
    function ConvertTo-RelPath {
        param([string]$Path)
        ($Path.Substring($repoRoot.Length).TrimStart('\','/')) -replace '\\', '/'
    }

    # Check 1 — Files that catch Exception, then cross with files that have NO logger call
    Write-Output "=== Check 1: Silent except blocks ==="
    $catchesException = Get-ChildItem -LiteralPath 'app' -Recurse -File -Filter '*.py' -ErrorAction SilentlyContinue |
        Select-String -Pattern 'except Exception' |
        ForEach-Object { ConvertTo-RelPath $_.Path } |
        Sort-Object -Unique

    $hasLogger = Get-ChildItem -LiteralPath 'app' -Recurse -File -Filter '*.py' -ErrorAction SilentlyContinue |
        Select-String -Pattern 'logger\.' |
        ForEach-Object { ConvertTo-RelPath $_.Path } |
        Sort-Object -Unique

    $silent = $catchesException | Where-Object { $_ -and ($hasLogger -notcontains $_) }
    if ($silent) { $silent | ForEach-Object { Write-Output "VIOLATION $_  catches Exception with no logger call" } }
    Write-Output ""

    Write-Output "=== Check 1b: Files where except-Exception count > logger.error/warning count (potential gaps) ==="
    foreach ($file in $catchesException) {
        $exceptCount = (Select-String -LiteralPath $file -Pattern 'except Exception' -AllMatches | Measure-Object).Count
        $logCount = (Select-String -LiteralPath $file -Pattern 'logger\.(error|warning)' -AllMatches | Measure-Object).Count
        if ($exceptCount -gt $logCount) {
            Write-Output "POTENTIAL $file  except-Exception=$exceptCount logger.error/warning=$logCount"
        }
    }
    Write-Output ""

    # Check 2 — Files in app/ that never declare a module logger (excluding __init__.py and logging_config.py)
    Write-Output "=== Check 2: Missing module-level logger ==="
    $allPy = Get-ChildItem -LiteralPath 'app' -Recurse -File -Filter '*.py' -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ne '__init__.py' -and (ConvertTo-RelPath $_.FullName) -ne 'app/core/logging_config.py' }
    $declaresLogger = $allPy | Select-String -Pattern 'logger = logging\.getLogger' |
        ForEach-Object { ConvertTo-RelPath $_.Path } | Sort-Object -Unique
    foreach ($file in $allPy) {
        $rel = ConvertTo-RelPath $file.FullName
        if ($declaresLogger -notcontains $rel) {
            Write-Output ("VIOLATION {0}  no 'logger = logging.getLogger(__name__)'" -f $rel)
        }
    }
    Write-Output ""

    # Check 3 — Files in app/api/ with no logger calls at all
    Write-Output "=== Check 3: Silent route handlers (no logger calls in app/api/) ==="
    $apiFiles = Get-ChildItem -LiteralPath 'app/api' -Recurse -File -Filter '*.py' -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -ne '__init__.py' }
    $apiWithLogger = $apiFiles | Select-String -Pattern 'logger\.' |
        ForEach-Object { ConvertTo-RelPath $_.Path } | Sort-Object -Unique
    foreach ($file in $apiFiles) {
        $rel = ConvertTo-RelPath $file.FullName
        if ($apiWithLogger -notcontains $rel) {
            Write-Output "VIOLATION $rel  no logger calls found"
        }
    }
    Write-Output ""

    exit 0
}
finally {
    Pop-Location
}
