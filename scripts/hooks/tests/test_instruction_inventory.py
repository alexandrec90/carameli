"""Carameli's deliberate project-local instruction inventory."""

from conftest import REPO_ROOT


def test_instruction_inventory_is_intentional():
    """New rules and skills are architecture decisions, not markdown accumulation."""
    skill_root = REPO_ROOT / ".claude" / "skills"
    rule_root = REPO_ROOT / ".claude" / "rules"
    skills = {path.parent.name for path in skill_root.glob("*/SKILL.md")}
    rules = {path.stem for path in rule_root.glob("*.md")}

    assert skills == {"add-skin", "ship"}
    assert rules == {
        "authoring",
        "engineering",
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
