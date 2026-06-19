[CmdletBinding()]
param(
    [int]$ViolationsThreshold = 25,
    [int]$TouchedFilesThreshold = 15,
    [int]$PerBatchFileCap = 10,
    [string]$RepoRoot = ''
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
    $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

$raw = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($raw)) {
    exit 0
}

try {
    $payload = $raw | ConvertFrom-Json -Depth 50
}
catch {
    # Fail open on malformed hook payload to avoid unrelated workflow breakage.
    exit 0
}

function Get-PropValue {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Object,
        [Parameter(Mandatory = $true)]
        [string[]]$Paths
    )

    foreach ($path in $Paths) {
        $current = $Object
        $ok = $true
        foreach ($segment in ($path -split '\.')) {
            if ($null -eq $current) {
                $ok = $false
                break
            }
            $prop = $current.PSObject.Properties[$segment]
            if ($null -eq $prop) {
                $ok = $false
                break
            }
            $current = $prop.Value
        }

        if ($ok) {
            return $current
        }
    }

    return $null
}

function ConvertTo-RepoRelativePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Base
    )

    $normalized = ($Path -replace '\\', '/').Trim()
    $normalized = ($normalized -replace '(\\n|/n)+$','').Trim()
    if ([string]::IsNullOrWhiteSpace($normalized)) {
        return $null
    }

    if ($normalized -match '^[A-Za-z]:/') {
        $baseNorm = ($Base -replace '\\', '/').TrimEnd('/')
        if ($normalized.StartsWith($baseNorm + '/', [System.StringComparison]::OrdinalIgnoreCase)) {
            return $normalized.Substring($baseNorm.Length + 1)
        }
        return $null
    }

    return $normalized.TrimStart('./')
}

function Add-ViolationFile {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Violation,
        [Parameter(Mandatory = $true)]
        [object]$Set,
        [Parameter(Mandatory = $true)]
        [string]$RepoRootPath
    )

    if ($Violation.PSObject.Properties['file']) {
        $rel = ConvertTo-RepoRelativePath -Path ([string]$Violation.file) -Base $RepoRootPath
        if ($rel) {
            [void]$Set.Add($rel)
        }
    }

    if ($Violation.PSObject.Properties['files'] -and $Violation.files -is [System.Collections.IEnumerable]) {
        foreach ($f in $Violation.files) {
            $rel = ConvertTo-RepoRelativePath -Path ([string]$f) -Base $RepoRootPath
            if ($rel) {
                [void]$Set.Add($rel)
            }
        }
    }

    if ($Violation.PSObject.Properties['occurrences'] -and $Violation.occurrences -is [System.Collections.IEnumerable]) {
        foreach ($occ in $Violation.occurrences) {
            if ($occ -and $occ.PSObject.Properties['file']) {
                $rel = ConvertTo-RepoRelativePath -Path ([string]$occ.file) -Base $RepoRootPath
                if ($rel) {
                    [void]$Set.Add($rel)
                }
            }
        }
    }
}

function Get-FilesFromToolPayload {
    param(
        [Parameter(Mandatory = $true)]
        [object]$HookPayload,
        [Parameter(Mandatory = $true)]
        [string]$RepoRootPath
    )

    $files = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)

    $toolInput = Get-PropValue -Object $HookPayload -Paths @('tool_input', 'toolInput', 'input')

    if ($toolInput) {
        try {
            $blob = $toolInput | ConvertTo-Json -Depth 50 -Compress
        }
        catch {
            $blob = [string]$toolInput
        }

        $patchMatches = [regex]::Matches($blob, '\*\*\*\s+(?:Update|Add|Delete)\s+File:\s+([^\r\n"]+)')
        foreach ($m in $patchMatches) {
            $candidate = $m.Groups[1].Value
            $rel = ConvertTo-RepoRelativePath -Path $candidate -Base $RepoRootPath
            if ($rel) {
                [void]$files.Add($rel)
            }
        }

        $pathMatches = [regex]::Matches($blob, '(app|frontend|tests|alembic|scripts|\.claude)\/[A-Za-z0-9_\-\.\/]+')
        foreach ($m in $pathMatches) {
            $rel = ConvertTo-RepoRelativePath -Path $m.Value -Base $RepoRootPath
            if ($rel) {
                [void]$files.Add($rel)
            }
        }

        $winPathMatches = [regex]::Matches($blob, '[A-Za-z]:\\\\[^\"\s]+')
        foreach ($m in $winPathMatches) {
            $rel = ConvertTo-RepoRelativePath -Path ($m.Value -replace '\\\\', '/') -Base $RepoRootPath
            if ($rel) {
                [void]$files.Add($rel)
            }
        }
    }

    return @($files)
}

function Split-IntoChunk {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Items,
        [Parameter(Mandatory = $true)]
        [int]$ChunkSize
    )

    if (-not $Items -or $Items.Count -eq 0) {
        return @()
    }

    $chunks = @()
    for ($i = 0; $i -lt $Items.Count; $i += $ChunkSize) {
        $take = [Math]::Min($ChunkSize, $Items.Count - $i)
        $slice = @($Items[$i..($i + $take - 1)])
        $chunks += ,$slice
    }
    return $chunks
}

$toolName = [string](Get-PropValue -Object $payload -Paths @('tool_name', 'toolName', 'tool.name', 'name'))
$writeTools = @('Edit', 'Write', 'MultiEdit', 'apply_patch', 'create_file')
if ($writeTools -notcontains $toolName) {
    exit 0
}

$skillDir = Join-Path $RepoRoot '.claude/skills/audit-design-flaws'
$rawAuditPath = Join-Path $skillDir 'raw-audit.json'
$batchPlanPath = Join-Path $skillDir 'batch-plan.json'
$batchActivePath = Join-Path $skillDir 'batch-active.json'

if (-not (Test-Path -LiteralPath $rawAuditPath)) {
    exit 0
}

try {
    $rawAudit = Get-Content -LiteralPath $rawAuditPath -Raw | ConvertFrom-Json -Depth 100
}
catch {
    # Fail open when artifact is malformed.
    exit 0
}

$violations = $rawAudit.violations
if (-not $violations) {
    exit 0
}

$totalViolations = 0
$allTouched = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)

$checks = @('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L')
foreach ($check in $checks) {
    $items = $violations.PSObject.Properties[$check].Value
    if ($items -is [System.Collections.IEnumerable]) {
        foreach ($item in $items) {
            $totalViolations += 1
            Add-ViolationFile -Violation $item -Set $allTouched -RepoRootPath $RepoRoot
        }
    }
}

$touchedCount = $allTouched.Count
if ($totalViolations -le $ViolationsThreshold -and $touchedCount -le $TouchedFilesThreshold) {
    exit 0
}

$groupMap = [ordered]@{
    low = @('E', 'F', 'G', 'I', 'L')
    medium = @('B', 'C', 'J', 'K')
    high = @('A', 'D', 'H')
}

if (-not (Test-Path -LiteralPath $batchPlanPath)) {
    $batches = @()

    foreach ($groupName in @('low', 'medium', 'high')) {
        $checkIds = $groupMap[$groupName]
        $groupFiles = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)

        foreach ($checkId in $checkIds) {
            $items = $violations.PSObject.Properties[$checkId].Value
            if ($items -is [System.Collections.IEnumerable]) {
                foreach ($item in $items) {
                    Add-ViolationFile -Violation $item -Set $groupFiles -RepoRootPath $RepoRoot
                }
            }
        }

        $groupFileList = @($groupFiles | Sort-Object)
        if ($groupFileList.Count -eq 0) {
            continue
        }

        $chunkSize = if ($groupName -eq 'high') { 1 } else { $PerBatchFileCap }
        $chunks = Split-IntoChunk -Items $groupFileList -ChunkSize $chunkSize
        $idx = 1
        foreach ($chunk in $chunks) {
            $batches += [ordered]@{
                id = "$groupName-$idx"
                group = if ($groupName -eq 'low') { 'low-risk mechanical' } elseif ($groupName -eq 'medium') { 'medium refactor' } else { 'high-risk structural' }
                checks = $checkIds
                maxFiles = $chunkSize
                files = $chunk
                status = 'pending'
            }
            $idx += 1
        }
    }

    $firstBatchId = if ($batches.Count -gt 0) { $batches[0].id } else { $null }
    $batchPlan = [ordered]@{
        version = 1
        generatedAt = (Get-Date).ToUniversalTime().ToString('o')
        thresholds = [ordered]@{
            violations = $ViolationsThreshold
            touchedFiles = $TouchedFilesThreshold
            perBatchFiles = $PerBatchFileCap
            highRiskPerBatch = 1
        }
        totals = [ordered]@{
            violations = $totalViolations
            touchedFiles = $touchedCount
        }
        batches = $batches
        currentBatchId = $firstBatchId
    }

    $batchPlan | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $batchPlanPath -Encoding utf8
    if ($firstBatchId) {
        ([ordered]@{ currentBatchId = $firstBatchId } | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath $batchActivePath -Encoding utf8
    }
}

try {
    $plan = Get-Content -LiteralPath $batchPlanPath -Raw | ConvertFrom-Json -Depth 100
}
catch {
    exit 42
}

$activeId = $null
if (Test-Path -LiteralPath $batchActivePath) {
    try {
        $active = Get-Content -LiteralPath $batchActivePath -Raw | ConvertFrom-Json -Depth 20
        $activeId = [string]$active.currentBatchId
    }
    catch {
        $activeId = $null
    }
}

if (-not $activeId) {
    $activeId = [string]$plan.currentBatchId
}

$currentBatch = $null
foreach ($b in @($plan.batches)) {
    if ([string]$b.id -eq $activeId) {
        $currentBatch = $b
        break
    }
}

if (-not $currentBatch) {
    # If no active batch is selected yet, fail closed with actionable guidance.
    Write-Output 'Blocked: Step 2.5 batch caps are active but no current batch is selected.'
    Write-Output "Set .claude/skills/audit-design-flaws/batch-active.json with {\"currentBatchId\":\"<batch-id>\"}."
    exit 42
}

$targetFiles = Get-FilesFromToolPayload -HookPayload $payload -RepoRootPath $RepoRoot
if (-not $targetFiles -or $targetFiles.Count -eq 0) {
    # Can't infer target paths reliably; fail open to avoid false positives.
    exit 0
}

$batchFilesSet = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
foreach ($f in @($currentBatch.files)) {
    if ($f) {
        [void]$batchFilesSet.Add(([string]$f -replace '\\', '/'))
    }
}

if ($targetFiles.Count -gt [int]$currentBatch.maxFiles) {
    Write-Output ("Blocked: current batch '{0}' allows at most {1} files per edit operation (got {2})." -f $currentBatch.id, $currentBatch.maxFiles, $targetFiles.Count)
    exit 42
}

$outside = @()
foreach ($f in $targetFiles) {
    $normalized = $f -replace '\\', '/'
    if (-not $batchFilesSet.Contains($normalized)) {
        $outside += $normalized
    }
}

if ($outside.Count -gt 0) {
    Write-Output ("Blocked by Step 2.5 caps: current batch '{0}' ({1}) only permits files listed in batch-plan.json." -f $currentBatch.id, $currentBatch.group)
    Write-Output ('Out-of-batch file(s): ' + (($outside | Select-Object -First 5) -join ', '))
    Write-Output 'Update batch-active.json to the correct batch before editing these files.'
    exit 42
}

exit 0
