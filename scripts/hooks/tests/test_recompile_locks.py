"""Tests for universal lock recompilation and its Dependabot workflow."""

from types import SimpleNamespace

from conftest import REPO_ROOT, load_module

locks = load_module("scripts/recompile-locks.py")


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


def test_dependabot_workflow_repairs_then_dispatches_gate():
    workflow = (REPO_ROOT / ".github/workflows/dependabot-lock-repair.yml").read_text(
        encoding="utf-8"
    )

    assert "github.actor == 'dependabot[bot]'" in workflow
    assert "head.repo.full_name == github.repository" in workflow
    assert "startsWith(github.event.pull_request.head.ref, 'dependabot/pip/')" in workflow
    assert "ref: ${{ github.event.pull_request.merge_commit_sha }}" in workflow
    assert "python scripts/recompile-locks.py" in workflow
    assert 'gh workflow run pr-gate.yml --ref "$HEAD_BRANCH"' in workflow


def test_typescript_majors_remain_enabled_but_manual_gated():
    config = (REPO_ROOT / ".github/dependabot.yml").read_text(encoding="utf-8")
    automerge = (REPO_ROOT / ".github/workflows/dependabot-automerge.yml").read_text(
        encoding="utf-8"
    )

    assert "dependency-name: typescript" not in config
    assert "steps.meta.outputs.update-type == 'version-update:semver-major'" in automerge
    assert "needs-manual-merge" in automerge


def test_automerge_matches_dispatched_gate_to_current_pr_head():
    workflow = (REPO_ROOT / ".github/workflows/dependabot-automerge.yml").read_text(
        encoding="utf-8"
    )

    assert "github.event.workflow_run.event == 'workflow_dispatch'" in workflow
    assert "RUN_HEAD_SHA: ${{ github.event.workflow_run.head_sha }}" in workflow
    assert "head_sha=$(echo \"$pr\" | jq -r '.headRefOid')" in workflow
    assert '[ "$author" != "app/dependabot" ]' in workflow
    assert '[ "$head_sha" != "$RUN_HEAD_SHA" ]' in workflow
