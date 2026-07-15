"""Invariants for the shared CI workflow conventions.

Three cross-cutting settings were rolled across the GitHub Actions workflows:

  * a least-privilege top-level ``permissions:`` block on every workflow,
  * a ``concurrency:`` group so redundant runs don't pile up (cancelling for
    PR / fixer runs, serializing without cancel for the scheduled suites), and
  * two composite actions (``.github/actions/setup-python-env`` and
    ``setup-node-env``) that replace the copy-pasted checkout+setup+install
    preamble that used to live in every job.

These tests lock those in so a new workflow -- or a careless edit -- can't
silently drop the hardening or reintroduce the duplication. Stdlib-only text
parse (no PyYAML), so they run in the hook-tests gate step before the venv is
guaranteed, alongside test_scheduled_workflows_free.py.
"""

from conftest import REPO_ROOT

WORKFLOWS_DIR = REPO_ROOT / ".github" / "workflows"
ACTIONS_DIR = REPO_ROOT / ".github" / "actions"

# Workflows whose Python setup preamble was folded into the composite action.
DEDUPED_WORKFLOWS = [
    "pr-gate.yml",
    "nightly.yml",
    "weekly.yml",
    "on-demand.yml",
    "sandbox-tests.yml",
]

# The manually-dispatched paid-tier workflow.
SANDBOX_WORKFLOW = "sandbox-tests.yml"


def _read(path) -> str:
    return path.read_text(encoding="utf-8")


def _has_top_level_key(text: str, key: str) -> bool:
    """True if `key:` appears at column 0 (a workflow-level mapping key)."""
    return any(line.rstrip() == f"{key}:" for line in text.splitlines())


def _workflow_files() -> list:
    return sorted(WORKFLOWS_DIR.glob("*.yml"))


def test_workflow_scan_is_not_vacuous():
    # Guard against a rename making every loop below pass over an empty set.
    names = {p.name for p in _workflow_files()}
    assert {"pr-gate.yml", "nightly.yml", "weekly.yml", "on-demand.yml"} <= names, (
        f"expected the core workflows, found {names}"
    )


def test_composite_setup_actions_exist():
    for name in ("setup-python-env", "setup-node-env"):
        action = ACTIONS_DIR / name / "action.yml"
        assert action.exists(), f"missing composite action {name}"
        assert "using: composite" in _read(action)


def test_every_workflow_declares_top_level_permissions():
    for path in _workflow_files():
        assert _has_top_level_key(_read(path), "permissions"), (
            f"{path.name}: no top-level `permissions:` block. Add a least-"
            "privilege default (`permissions:` / `  contents: read`); jobs that "
            "need more opt in with their own job-level block."
        )


def test_workflows_declare_concurrency_except_automerge():
    # dependabot-automerge.yml deliberately omits concurrency: its merge job is
    # driven by workflow_run completion events that must not be dropped.
    for path in _workflow_files():
        if path.name == "dependabot-automerge.yml":
            continue
        assert _has_top_level_key(_read(path), "concurrency"), (
            f"{path.name}: no top-level `concurrency:` block."
        )


def test_pr_and_fixer_runs_cancel_superseded():
    for name in ("pr-gate.yml", "on-demand.yml"):
        text = _read(WORKFLOWS_DIR / name)
        assert "cancel-in-progress: true" in text, (
            f"{name}: PR / fixer runs should cancel superseded in-flight runs."
        )


def test_scheduled_suites_do_not_cancel_in_progress():
    for name in ("nightly.yml", "weekly.yml"):
        text = _read(WORKFLOWS_DIR / name)
        assert "cancel-in-progress: false" in text, (
            f"{name}: a scheduled full suite must be allowed to finish (cancel-in-progress: false)."
        )


def test_sandbox_workflow_is_dispatch_only():
    # The paid-tier workflow deliberately runs `-m sandbox` (which drops the
    # `not paid` guard), so it must never fire automatically. A `schedule:`,
    # `push:`, or `pull_request:` trigger here would make an automated run hit a
    # live provider -- the one thing the paid/free tiering exists to prevent.
    # Scan uncommented lines only: the header comment names these triggers on
    # purpose (to say "never add one").
    text = _read(WORKFLOWS_DIR / SANDBOX_WORKFLOW)
    trigger_block = text.split("\npermissions:", 1)[0]
    code_lines = [ln for ln in trigger_block.splitlines() if not ln.lstrip().startswith("#")]
    for forbidden in ("schedule:", "pull_request:", "push:"):
        offenders = [ln for ln in code_lines if ln.strip().startswith(forbidden)]
        assert not offenders, (
            f"{SANDBOX_WORKFLOW}: found a `{forbidden}` trigger. This workflow "
            "runs paid tests and must stay workflow_dispatch-only."
        )
    assert any(ln.strip().startswith("workflow_dispatch:") for ln in code_lines)


def test_sandbox_workflow_opts_into_the_sandbox_tier_via_environment():
    text = _read(WORKFLOWS_DIR / SANDBOX_WORKFLOW)
    # Runs the tier-1 marker (not the free default), behind a GitHub environment
    # so its credentials are scoped and a reviewer gate can be attached.
    assert "pytest -m sandbox" in text
    assert "environment: sandbox" in text
    assert "${{ secrets.TELNYX_API_KEY }}" in text
    assert 'TELNYX_SANDBOX: "1"' in text


def test_setup_preamble_is_not_duplicated_inline():
    # The composite owns the "install the compiled locks" preamble now; a
    # workflow reintroducing it inline is exactly the drift this removed.
    for name in DEDUPED_WORKFLOWS:
        text = _read(WORKFLOWS_DIR / name)
        assert "./.github/actions/setup-python-env" in text, (
            f"{name}: should set up Python via the setup-python-env composite."
        )
        assert "pip install -r requirements.txt -r requirements-dev.txt" not in text, (
            f"{name}: inline lock-install preamble reintroduced; use the "
            "setup-python-env composite instead."
        )
