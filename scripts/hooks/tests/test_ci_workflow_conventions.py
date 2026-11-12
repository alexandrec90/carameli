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

import re

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
    assert 'pytest -m "sandbox and not chargeable"' in text
    assert "environment: sandbox" in text
    assert "${{ secrets.TELNYX_API_KEY }}" in text
    assert 'TELNYX_SANDBOX: "1"' in text


def test_devkit_checkout_pins_a_release_tag():
    # The mirror-sync job checks the vendored harness against whatever this ref
    # resolves to, so `main` (or a branch) would let one upstream commit redden
    # this repo's gate with no change here. Only an immutable vX.Y.Z tag.
    text = _read(WORKFLOWS_DIR / "pr-gate.yml")
    block = re.search(
        r"repository:\s*alexandrec90/devkit\s*\n\s*ref:\s*(\S+)",
        text,
    )
    assert block, "pr-gate.yml: no `repository: alexandrec90/devkit` + `ref:` pair found."
    assert re.fullmatch(r"v\d+\.\d+\.\d+", block.group(1)), (
        f"pr-gate.yml pins the devkit checkout at {block.group(1)!r}; it must be a "
        "release tag (vX.Y.Z), never a branch. Bump it in the same commit as the "
        "`sync-devkit.py --pull` it corresponds to."
    )


def test_harness_version_records_a_commit():
    # `--pull` stamps DEVKIT_VERSION with the upstream short SHA. An empty or
    # placeholder value means the vendored copy has no recorded provenance, so
    # nothing ties the files on disk to the tag the gate above checks them against.
    stamped = (REPO_ROOT / "DEVKIT_VERSION").read_text(encoding="utf-8").strip()
    assert re.fullmatch(r"[0-9a-f]{7,40}", stamped), (
        f"DEVKIT_VERSION is {stamped!r}; expected the upstream commit SHA written "
        "by `python scripts/sync-devkit.py --pull`."
    )


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


# A step calling one of this repository's composite actions: `- uses: ./.github/actions/x`
# or, after a `name:` line, `  uses: ./.github/actions/x`.
_LOCAL_ACTION_STEP = re.compile(r"^[ -]*uses:\s*\./\.github/actions/(?P<name>[\w.-]+)\s*$")
_MAPPING_KEY = re.compile(r"^(?P<key>[\w-]+):")


def _indent(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def _key_column(line: str) -> int:
    """Column of the first mapping key on a step line, past any `- ` list marker."""
    return len(line) - len(line.lstrip(" -"))


def _passed_inputs(text: str) -> list[tuple[str, str]]:
    """`(action, input)` for every `with:` key a step hands a local composite action."""
    lines = text.splitlines()
    found = []
    for index, line in enumerate(lines):
        match = _LOCAL_ACTION_STEP.match(line)
        if not match:
            continue
        column = _key_column(line)
        in_with = False
        for following in lines[index + 1 :]:
            stripped = following.strip()
            if not stripped or stripped.startswith("#"):
                continue
            depth = _indent(following)
            if depth < column or (stripped.startswith("- ") and depth <= column):
                break
            if depth == column:
                in_with = stripped == "with:"
                continue
            key = _MAPPING_KEY.match(stripped)
            if in_with and key:
                found.append((match["name"], key["key"]))
    return found


def _declared_inputs(action_text: str) -> set[str]:
    """The keys under an action.yml's top-level `inputs:` block."""
    declared: set[str] = set()
    in_inputs = False
    for line in action_text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if _indent(line) == 0:
            in_inputs = line.rstrip() == "inputs:"
            continue
        key = _MAPPING_KEY.match(line.strip())
        if in_inputs and _indent(line) == 2 and key:
            declared.add(key["key"])
    return declared


def test_passed_inputs_reads_both_step_shapes():
    text = (
        "    steps:\n"
        "      - uses: ./.github/actions/setup-python-env\n"
        "        with:\n"
        "          # a comment is not an input\n"
        "          python-version: '3.12'\n"
        "      - name: Second\n"
        "        uses: ./.github/actions/setup-node-env\n"
        "        with:\n"
        "          cache: npm\n"
        "        env:\n"
        "          NOT_AN_INPUT: x\n"
        "      - uses: actions/checkout@v7\n"
        "        with:\n"
        "          ref: main\n"
    )
    assert _passed_inputs(text) == [
        ("setup-python-env", "python-version"),
        ("setup-node-env", "cache"),
    ]


def test_declared_inputs_reads_only_the_inputs_block():
    text = (
        "name: x\n"
        "inputs:\n"
        "  extra-packages:\n"
        "    description: d\n"
        "    default: ''\n"
        "  python-version:\n"
        "    required: false\n"
        "runs:\n"
        "  using: composite\n"
    )
    assert _declared_inputs(text) == {"extra-packages", "python-version"}


def test_every_input_passed_to_a_local_action_is_declared():
    # The composite actions are this project's own, but some workflows calling them are
    # vendored from devkit, written against devkit's template of the action. The
    # auto-merge workflow passed `python-version` to a setup-python-env that declared
    # only `extra-packages`, and actionlint turned the PR Gate red on master. Holding
    # every call site to its action's declared inputs catches that here as well.
    passed = [
        (path.name, action, key)
        for path in _workflow_files()
        for action, key in _passed_inputs(_read(path))
    ]
    assert passed, "no step passes an input to a local action; the scan is vacuous"
    undeclared = [
        f"{name}: {action} has no input {key!r}"
        for name, action, key in passed
        if key not in _declared_inputs(_read(ACTIONS_DIR / action / "action.yml"))
    ]
    assert not undeclared, undeclared


def test_setup_python_env_takes_the_interpreter_from_the_pin_only():
    # `.python-version` is the one copy (CLAUDE.md, "Local workflow"). The vendored
    # caller's `python-version` comes from `.devkit.toml` with a hard-coded fallback, so
    # letting it reach setup-python would provision a second, unenforced pin.
    text = _read(ACTIONS_DIR / "setup-python-env" / "action.yml")
    assert "python-version" in _declared_inputs(text)
    assert "python-version-file: .python-version" in text
    assert "python-version: ${{ inputs.python-version }}" not in text, (
        "setup-python-env must never hand the caller's version to actions/setup-python."
    )
    assert "disagrees with .python-version" in text, (
        "a caller's version that is not the pin should fail the step, not be ignored."
    )
