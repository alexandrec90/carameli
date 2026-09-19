"""Contract tests for this repo's `.gitignore`.

A `.gitignore` line is the one kind of repo configuration whose absence has no symptom:
nothing is red, nothing is slow, and the file it should have excluded simply becomes
part of the repository the next time somebody stages everything. So the lines that exist
to stop a specific file coming back are asserted here rather than left to a reviewer
noticing a diff.
"""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
GITIGNORE = REPO_ROOT / ".gitignore"


def lines() -> list[str]:
    return [line.strip() for line in GITIGNORE.read_text(encoding="utf-8").splitlines()]


def test_a_root_agents_md_cannot_be_staged() -> None:
    """A tool outside this repo writes an `AGENTS.md` mirror of the root `CLAUDE.md`
    into this checkout. Nothing here generates it: Codex reads `CLAUDE.md` through
    `project_doc_fallback_filenames`, and devkit deleted its own tracked copy in v0.6.0.
    Untracked and unignored, it was invisible to every gate, so `git add -A` recommitted
    it twice -- the `sweep: park stranded work` commits `bb9d6d6` and `dd7efc5`.

    Rooted on purpose: an unanchored `AGENTS.md` would also swallow a genuine one inside
    a vendored tree.
    """
    assert "/AGENTS.md" in lines()


def test_the_repo_carries_no_agents_md() -> None:
    """The other half. The ignore stops it being staged again; this says it is not here
    now -- a file already tracked stays tracked whatever `.gitignore` says."""
    found = sorted(
        path.relative_to(REPO_ROOT).as_posix()
        for path in REPO_ROOT.glob("AGENTS.md")
    )
    assert found == [], (
        f"delete {found}: a second instruction tree drifts from CLAUDE.md and is the "
        f"copy nothing tests"
    )
