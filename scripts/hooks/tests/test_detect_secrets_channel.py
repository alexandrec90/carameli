"""detect-secrets is pinned upstream and stays in step with the venv's copy.

Not vendored: this pins *this repo's* wiring of the scanner, the kind of
project-specific coupling the vendored tier must not carry.

Why each assertion earns its place:

- **Not `language: system`.** As a system hook it was the only entry in
  `.pre-commit-config.yaml` that needed the worktree's `.venv` on PATH, and
  pre-commit fails a hook whose executable it cannot find -- so a fresh worktree
  could not commit until it was provisioned, and the symptom read as a broken gate.
  Letting pre-commit own the environment is what makes the commit gate work before
  anything is installed.
- **Pinned by tag.** A branch pin means one upstream commit can redden this repo
  with no local change.
- **One version, three places.** `scripts/lint-all.py` scans with the venv's
  detect-secrets and this hook scans with pre-commit's; both write
  `.secrets.baseline`, whose own `version` field records the writer. Two versions
  over one baseline rewrite each other's results, which is churn nothing settles.
- **`--baseline` is passed.** Without it the hook scans with no baseline and every
  acknowledged finding blocks the commit again.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
PRE_COMMIT = REPO_ROOT / ".pre-commit-config.yaml"
DEV_LOCK = REPO_ROOT / "requirements-dev.txt"
BASELINE = REPO_ROOT / ".secrets.baseline"

SCANNER_REPO = "https://github.com/Yelp/detect-secrets"


def _hook_and_repo() -> tuple[dict, dict]:
    """Return the (hook, repo) mappings for the detect-secrets hook."""
    config = yaml.safe_load(PRE_COMMIT.read_text(encoding="utf-8"))
    for repo in config["repos"]:
        for hook in repo.get("hooks") or []:
            if hook.get("id") == "detect-secrets":
                return hook, repo
    raise AssertionError(f"no detect-secrets hook in {PRE_COMMIT.name}")


def _pinned_version() -> str:
    """The detect-secrets release the pre-commit hook installs, without the `v`."""
    _, repo = _hook_and_repo()
    return str(repo["rev"]).lstrip("v")


def test_detect_secrets_comes_from_upstream_not_the_local_venv():
    _, repo = _hook_and_repo()
    assert repo["repo"] == SCANNER_REPO, (
        "detect-secrets must be pinned to its upstream repo so pre-commit builds the "
        "tool its own environment; a `repo: local` entry needs the worktree's venv, "
        "which a fresh worktree does not have yet."
    )


def test_detect_secrets_does_not_reach_for_a_provisioned_environment():
    hook, _ = _hook_and_repo()
    overridden = sorted(set(hook) & {"language", "entry"})
    assert not overridden, (
        f"detect-secrets overrides {overridden}, which puts resolving the executable "
        "back on the worktree. Let pre-commit's own python environment supply it."
    )


def test_detect_secrets_is_pinned_to_a_tag_not_a_branch():
    _, repo = _hook_and_repo()
    assert re.fullmatch(r"v\d+\.\d+\.\d+", str(repo["rev"])), (
        f"detect-secrets rev {repo['rev']!r} is not a version tag. Never pin a branch: "
        "one bad upstream commit would redden this repo with no change here."
    )


def test_pinned_rev_matches_the_dev_lock_pin():
    """The hook and `scripts/lint-all.py` must scan with the same scanner."""
    match = re.search(r"^detect-secrets==(\S+)$", DEV_LOCK.read_text(encoding="utf-8"), re.M)
    assert match, f"no detect-secrets pin in {DEV_LOCK.name} -- did lint-all lose its scanner?"
    assert _pinned_version() == match.group(1), (
        f"pre-commit installs detect-secrets {_pinned_version()} but the dev lock pins "
        f"{match.group(1)}. Both write .secrets.baseline; bump them together "
        "(requirements-dev.in, then a lock recompile)."
    )


def test_pinned_rev_matches_the_baseline_writer():
    """`.secrets.baseline`'s `version` records which scanner produced it."""
    version = json.loads(BASELINE.read_text(encoding="utf-8"))["version"]
    assert _pinned_version() == version, (
        f"pre-commit installs detect-secrets {_pinned_version()} but .secrets.baseline "
        f"was written by {version}. Re-scan the baseline with the pinned version."
    )


def test_hook_is_given_the_baseline():
    hook, _ = _hook_and_repo()
    args = hook.get("args") or []
    assert args[:2] == ["--baseline", ".secrets.baseline"], (
        f"detect-secrets args are {args!r}; without `--baseline .secrets.baseline` the "
        "hook scans with no baseline and every acknowledged finding blocks the commit."
    )
