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
        "skin-comic-book",
        # The reference half of skin-comic-book, split off so neither file crosses
        # the 500-line instruction limit. Not a second opinion about the skin.
        "skin-comic-book-framing",
        "voip-providers",
        "webhooks",
    }
