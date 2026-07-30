"""Contracts for the project-specific fix-prs dispatcher instructions."""

from conftest import REPO_ROOT


def test_artifactless_infrastructure_failures_use_a_bounded_failed_step_log():
    skill = REPO_ROOT / ".claude" / "skills" / "fix-prs" / "SKILL.md"
    text = skill.read_text(encoding="utf-8").lower()

    assert "artifactless infrastructure" in text
    assert "gh run view <run-id> --log-failed --job=<job-id>" in text
    assert "diagnostic only" in text
