@{
    # Project-wide PSScriptAnalyzer settings for scripts/
    ExcludeRules = @(
        # All task scripts intentionally use Write-Host for colored VS Code terminal output.
        # These are UI-only prints, not pipeline output -- PSAvoidUsingWriteHost does not apply.
        'PSAvoidUsingWriteHost',

        # Project convention is ASCII-only .ps1 files (no non-ASCII chars, no BOM needed).
        'PSUseBOMForUnicodeEncodedFile',

        # Simple helper scripts/filters don't need -WhatIf / SupportsShouldProcess support.
        'PSUseShouldProcessForStateChangingFunctions'
    )
}
