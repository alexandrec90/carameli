"""Carameli's deliberate project-local instruction inventory."""

from conftest import REPO_ROOT, load_module

manifest = load_module("scripts/devkit_manifest.py")


def _vendored_names(prefix: str, suffix: str) -> set[str]:
    """Names of the devkit-vendored entries under `prefix`: devkit's decision, not ours.

    Pinning them here made every devkit release that added a skill or rule red on its
    own adoption PR (v0.11.35's `go-nuts` did), for a file this test cannot keep out:
    `sync-devkit.py --check` already gates their presence and content.
    """
    names = set()
    for path in manifest.MANIFEST:
        if path.startswith(prefix) and path.endswith(suffix):
            names.add(path[len(prefix) :].removesuffix(suffix).split("/")[0])
    return names


def test_vendored_names_come_from_the_devkit_manifest():
    assert {"ship", "go-nuts"} <= _vendored_names(".claude/skills/", "/SKILL.md")
    assert {"engineering", "authoring", "session-scope"} <= _vendored_names(".claude/rules/", ".md")


def test_instruction_inventory_is_intentional():
    """New rules and skills are architecture decisions, not markdown accumulation."""
    skill_root = REPO_ROOT / ".claude" / "skills"
    rule_root = REPO_ROOT / ".claude" / "rules"
    skills = {path.parent.name for path in skill_root.glob("*/SKILL.md")}
    rules = {path.stem for path in rule_root.glob("*.md")}

    assert skills - _vendored_names(".claude/skills/", "/SKILL.md") == {"add-skin"}
    assert rules - _vendored_names(".claude/rules/", ".md") == {
        "security",
        "skin-architecture",
        "skin-barebone",
        "skin-candy-shop",
        "skin-carameli",
        # One file, deliberately. It was four — framing, motion and sms split off to
        # stay under the 500-line limit — but three of the four carried the same
        # `paths:` glob, so every one of them loaded on every comic-book file: 857
        # lines against a limit meant to cap 500. A split that does not narrow scope
        # buys nothing; the fix was to cut the prose, not to add files.
        "skin-comic-book",
        "voip-providers",
        "webhooks",
    }
