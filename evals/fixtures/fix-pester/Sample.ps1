# Fixture for the fix-pester eval task. Get-Greeting returns a farewell instead of
# a greeting - the failure described in the seeded Pester log. The fix swaps the
# literal to "Hello, $Name". ASCII only (tooling.md). Leave it broken; it is test data.
function Get-Greeting {
    param([string]$Name)
    # BUG: returns a farewell instead of a greeting
    return "Goodbye, $Name"
}
