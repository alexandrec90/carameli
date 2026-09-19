"""Tests for universal lock recompilation and its Dependabot workflow."""

import json
from types import SimpleNamespace

from conftest import REPO_ROOT, load_module

locks = load_module("scripts/recompile-locks.py")


def test_compile_commands_target_the_repo_pin():
    """The locks must be compiled for the interpreter the image runs, and the version
    was spelled out here as a literal -- a second pin beside `.python-version` that no
    bump of the first would ever move. A lock compiled for the wrong minor resolves
    different wheels and markers, and nothing in CI builds the image to notice."""
    pin = (REPO_ROOT / ".python-version").read_text(encoding="utf-8").strip()

    for command in locks.compile_commands("python"):
        assert command[command.index("--python-version") + 1] == pin


def test_compile_commands_take_an_explicit_target_for_testing():
    commands = locks.compile_commands("python", target_version="3.99")

    assert all(c[c.index("--python-version") + 1] == "3.99" for c in commands)


def test_compile_commands_preserve_constraint_order():
    commands = locks.compile_commands("python")

    assert [command[8] for command in commands] == [
        "requirements.in",
        "requirements-test.in",
        "requirements-dev.in",
    ]
    assert commands[0][-2:] == ["-o", "requirements.txt"]
    assert commands[1][-2:] == ["-c", "requirements.txt"]
    assert commands[2][-2:] == ["-c", "requirements-test.txt"]
    assert all("--universal" in command for command in commands)


def test_run_commands_stops_at_first_failure(monkeypatch):
    calls = []
    results = iter(
        [
            SimpleNamespace(returncode=0, stdout="first ok\n"),
            SimpleNamespace(returncode=9, stdout="second failed\n"),
        ]
    )

    def fake_run(command, **kwargs):
        calls.append(command)
        return next(results)

    monkeypatch.setattr(locks.subprocess, "run", fake_run)
    commands = [["one"], ["two"], ["three"]]

    code, output, failed = locks.run_commands(commands)

    assert code == 9
    assert calls == [["one"], ["two"]]
    assert output == ["first ok", "second failed"]
    assert failed == ["two"]


def test_failure_report_is_actionable_and_bounded():
    report = locks.failure_report(["python", "-m", "uv"], [str(i) for i in range(100)])

    assert report.startswith("# source: scripts/recompile-locks.py")
    assert "# fix: python scripts/recompile-locks.py" in report
    assert "requirements.in:1:1: LOCK_COMPILE_FAILED" in report
    assert "\n0\n" not in report
    assert "\n99\n" in report


def test_dependabot_workflow_repairs_then_gates_and_merges():
    workflow = (REPO_ROOT / ".github/workflows/dependabot-lock-repair.yml").read_text(
        encoding="utf-8"
    )

    assert "github.actor == 'dependabot[bot]'" in workflow
    assert "head.repo.full_name == github.repository" in workflow
    assert "startsWith(github.event.pull_request.head.ref, 'dependabot/pip/')" in workflow
    assert "ref: ${{ github.event.pull_request.merge_commit_sha }}" in workflow
    assert "python scripts/recompile-locks.py" in workflow
    assert 'gh workflow run pr-gate.yml --repo "$REPO" --ref "$HEAD_BRANCH"' in workflow


def test_lock_repair_watches_its_dispatched_gate_and_merges_itself():
    # A PR Gate run dispatched with GITHUB_TOKEN emits no workflow_run event
    # (GitHub recursion guard), so the auto-merge workflow can never see it.
    # The repair workflow must watch the run it dispatched and merge directly,
    # with the same guards as the auto-merge workflow.
    workflow = (REPO_ROOT / ".github/workflows/dependabot-lock-repair.yml").read_text(
        encoding="utf-8"
    )

    assert "pull-requests: write" in workflow
    assert 'echo "sha=$(git rev-parse HEAD)"' in workflow
    assert 'select(.headSha == \\"$REPAIRED_SHA\\")' in workflow
    assert 'gh run watch "$run_id" --repo "$REPO" --interval 15 --exit-status' in workflow
    assert '[ "$author" != "app/dependabot" ]' in workflow
    assert '[ "$head_sha" != "$REPAIRED_SHA" ]' in workflow
    assert 'index("automerge")' in workflow
    assert 'gh pr merge "$PR_NUMBER" --repo "$REPO" --merge' in workflow


def test_frontend_toolchain_majors_are_delayed_grouped_and_manual_gated():
    config = (REPO_ROOT / ".github/dependabot.yml").read_text(encoding="utf-8")
    automerge = (REPO_ROOT / ".github/workflows/dependabot-automerge.yml").read_text(
        encoding="utf-8"
    )

    assert "dependency-name: typescript" not in config
    assert "semver-major-days: 30" in config
    assert "lint-typecheck-toolchain:" in config
    assert config.index("lint-typecheck-toolchain:") < config.index("minor-and-patch:")
    for pattern in (
        '"typescript"',
        '"typescript-eslint"',
        '"@typescript-eslint/*"',
        '"eslint"',
        '"@eslint/*"',
        '"eslint-plugin-*"',
        '"eslint-import-resolver-*"',
    ):
        assert f"- {pattern}" in config
    assert "needs-manual-merge" in automerge


def test_stylelint_moves_as_one_toolchain():
    # stylelint majors and stylelint-config-standard majors pin each other;
    # separate PRs (48/49) each failed npm ci on peer conflicts.
    config = (REPO_ROOT / ".github/dependabot.yml").read_text(encoding="utf-8")

    assert "stylelint-toolchain:" in config
    assert '- "stylelint"' in config
    assert '- "stylelint-*"' in config
    assert config.index("stylelint-toolchain:") < config.index("minor-and-patch:")


def test_dependabot_watches_actions_and_docker_ecosystems():
    # npm and pip alone leave CI actions (actions/checkout@vN, …) and the
    # Dockerfile base image silently unmaintained.
    config = (REPO_ROOT / ".github/dependabot.yml").read_text(encoding="utf-8")

    assert "package-ecosystem: github-actions" in config
    assert "package-ecosystem: docker" in config


def test_python_base_image_is_never_bot_bumped():
    # Docker tags make 3.12→3.14 a semver-minor, which auto-merged (PR #43)
    # against locks compiled for the pinned minor with no image build in CI. The
    # runtime moves with the locks and CI config, deliberately.
    #
    # The expected tag is read from `.python-version` rather than spelled out: a
    # literal here would have to be edited by the very bump it is meant to describe,
    # and `tests/unit/test_python_version_pin.py` already owns pin-vs-Dockerfile.
    pin = (REPO_ROOT / ".python-version").read_text(encoding="utf-8").strip()
    config = (REPO_ROOT / ".github/dependabot.yml").read_text(encoding="utf-8")
    dockerfile = (REPO_ROOT / "Dockerfile").read_text(encoding="utf-8")

    docker_block = config[config.index("package-ecosystem: docker") :]
    assert 'dependency-name: "python"' in docker_block
    assert "version-update:semver-minor" in docker_block
    assert dockerfile.count(f"FROM python:{pin}-slim") == 2


def test_pr_gate_typechecks_builds_and_runs_hook_tests():
    # Unit tests alone let compile breaks through (react-router 7 and
    # tailwind 4 both merged green while breaking tsc/vite build); the gate
    # must build for real. Hook/workflow tests are excluded from the app
    # suite by pytest.ini, so the gate must invoke them explicitly.
    #
    # The gate reaches the build through `test:bundle`, which builds and then
    # measures the result against frontend/bundlePolicy.ts. Asserting the
    # literal "npm run build" would pass for a script that merely mentions it,
    # so check the chain instead: the gate runs test:bundle, and test:bundle
    # runs the build. Both halves have to hold for a compile break to fail here.
    gate = (REPO_ROOT / ".github/workflows/pr-gate.yml").read_text(encoding="utf-8")
    package_json = json.loads((REPO_ROOT / "frontend/package.json").read_text(encoding="utf-8"))

    assert "npm run test:bundle" in gate
    assert "npm run build" in package_json["scripts"]["test:bundle"]
    assert "pytest scripts/hooks/tests/" in gate


def test_automerge_classifies_dev_only_majors_as_automergeable():
    # Patch/minor bumps and majors confined to devDependencies auto-merge; a
    # major touching any runtime dependency stays manual. The per-dependency
    # JSON is the only metadata granular enough to decide this for group PRs.
    automerge = (REPO_ROOT / ".github/workflows/dependabot-automerge.yml").read_text(
        encoding="utf-8"
    )

    assert "steps.meta.outputs.updated-dependencies-json" in automerge
    assert "all(.[];" in automerge
    assert '.updateType == "version-update:semver-patch"' in automerge
    assert '.updateType == "version-update:semver-minor"' in automerge
    assert '.updateType == "version-update:semver-major" and' in automerge
    assert '.dependencyType == "direct:development"' in automerge
    assert 'then "automerge"' in automerge
    assert 'else "needs-manual-merge"' in automerge


def test_automerge_merge_job_only_trusts_dependabot_gate_on_current_head():
    # Since devkit v0.10.0 the guards live in the vendored
    # scripts/merge-dependabot-prs.py rather than inline bash, and the workflow
    # legitimately carries `workflow_dispatch` as a trigger for its scheduled retry
    # sweep. The properties this test exists for are unchanged and asserted where
    # they now live -- the last rewrite of this test already recorded the lesson:
    # pinning one spelling makes a guard's arrival from upstream look like the
    # guard going missing.
    workflow = (REPO_ROOT / ".github/workflows/dependabot-automerge.yml").read_text(
        encoding="utf-8"
    )
    script = (REPO_ROOT / "scripts/merge-dependabot-prs.py").read_text(encoding="utf-8")

    # The event-driven merge still fires only for a real pull_request gate run...
    assert "github.event.workflow_run.event == 'pull_request'" in workflow
    # ...and hands the script the gated commit, so a head that moved cannot inherit
    # the merge. Both jobs delegate to the script, which re-derives every guard from
    # the PR's current state (pinned upstream by test_merge_dependabot_prs.py).
    assert "RUN_HEAD_SHA: ${{ github.event.workflow_run.head_sha }}" in workflow
    assert "scripts/merge-dependabot-prs.py" in workflow
    # A hand-dispatched gate run still mints no evidence: the script accepts only a
    # successful pull_request-event run of the gate on the exact head SHA.
    assert '"pull_request"' in script and "gate_passed" in script
    # There is deliberately no author guard any more -- the automerge label, which
    # only write access can apply, is the whole authorization.
    assert "workflow_run.actor" not in workflow
