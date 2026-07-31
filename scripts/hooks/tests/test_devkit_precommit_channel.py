"""The devkit pre-commit channel stays pinned, complete, and in step with the gate.

Not vendored: this pins *this repo's* adoption of the channel, which is exactly the
kind of project-specific coupling the vendored tier must not carry.

Why each assertion earns its place:

- **Pinned by tag.** A branch pin means one upstream commit can redden this repo with
  no local change. The devkit README calls this out as a standing sharp edge.
- **All three ids.** Dropping one is silent — pre-commit just runs fewer hooks, and
  the one most likely to be dropped is `devkit-drift`, the only check that cannot
  degrade into a no-op the way `sync-devkit.py --check` does when `$DEVKIT_DIR` is
  unset.
- **Same rev as the PR gate and the version stamp.** All three name the upstream
  revision this repo is vendored from. When they disagree, the commit-time gate and
  the CI gate compare against different trees, and the disagreement is invisible until
  one of them fails for a reason that looks unrelated.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
PRE_COMMIT = REPO_ROOT / ".pre-commit-config.yaml"
PR_GATE = REPO_ROOT / ".github" / "workflows" / "pr-gate.yml"
VERSION_STAMP = REPO_ROOT / "DEVKIT_VERSION"

DEVKIT_REPO = "https://github.com/alexandrec90/devkit"
REQUIRED_HOOK_IDS = ("devkit-manifest", "devkit-hooks-stdlib-only", "devkit-drift")

# `rev: v0.5.2` on the line following the devkit `repo:` entry.
_DEVKIT_BLOCK_RE = re.compile(
    rf"-\s*repo:\s*{re.escape(DEVKIT_REPO)}\s*\n\s*rev:\s*(?P<rev>\S+)",
    re.MULTILINE,
)


def _pre_commit_text() -> str:
    return PRE_COMMIT.read_text(encoding="utf-8")


def _pinned_rev() -> str:
    match = _DEVKIT_BLOCK_RE.search(_pre_commit_text())
    assert match, f"no devkit `repo:` block with a `rev:` in {PRE_COMMIT.name}"
    return match.group("rev")


def test_devkit_channel_is_configured():
    assert DEVKIT_REPO in _pre_commit_text(), (
        "the devkit pre-commit channel is not configured. `devkit-drift` is the only "
        "drift check that cannot silently no-op, so losing it is a real regression."
    )


def test_devkit_is_pinned_to_a_tag_not_a_branch():
    rev = _pinned_rev()
    assert re.fullmatch(r"v\d+\.\d+\.\d+", rev), (
        f"devkit rev {rev!r} is not a version tag. Never pin a branch: one bad "
        f"upstream commit would redden this repo with no change here."
    )


def test_all_three_published_hooks_are_enabled():
    text = _pre_commit_text()
    missing = [h for h in REQUIRED_HOOK_IDS if f"id: {h}" not in text]
    assert not missing, f"devkit hooks configured but not enabled: {missing}"


def test_pinned_rev_matches_the_pr_gate_ref():
    """Commit-time and CI gates must compare against the same upstream tree."""
    gate_refs = re.findall(r"ref:\s*(v\d+\.\d+\.\d+)", PR_GATE.read_text(encoding="utf-8"))
    assert gate_refs, "pr-gate.yml pins no devkit ref — the CI drift job lost its checkout"
    assert _pinned_rev() in gate_refs, (
        f"pre-commit pins {_pinned_rev()} but pr-gate.yml pins {gate_refs}. Bump them together."
    )


def test_version_stamp_is_present():
    """`--pull` writes this; its absence means the vendored tree's origin is unknown."""
    assert VERSION_STAMP.is_file(), "DEVKIT_VERSION is missing — has --pull ever run?"
    assert VERSION_STAMP.read_text(encoding="utf-8").strip(), "DEVKIT_VERSION is empty"
