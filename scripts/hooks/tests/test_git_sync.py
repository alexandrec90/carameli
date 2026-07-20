"""Tests for scripts/git-sync.py."""

import subprocess

from conftest import load_module

git_sync = load_module("scripts/git-sync.py")


def result(returncode: int = 0, stdout: str = "", stderr: str = ""):
    return subprocess.CompletedProcess([], returncode, stdout, stderr)


def test_refuses_dirty_worktree_without_fetching(monkeypatch, capsys):
    calls = []

    def fake_run_git(*args, **kwargs):
        calls.append((args, kwargs))
        return result(stdout=" M app/main.py\n")

    monkeypatch.setattr(git_sync, "run_git", fake_run_git)

    assert git_sync.main() == 1
    assert calls == [(("status", "--porcelain"), {"capture_output": True})]
    assert "never stash" in capsys.readouterr().err


def test_refuses_detached_head(monkeypatch, capsys):
    responses = iter([result(), result(stdout="\n")])
    monkeypatch.setattr(git_sync, "run_git", lambda *args, **kwargs: next(responses))

    assert git_sync.main() == 1
    assert "HEAD is detached" in capsys.readouterr().err


def test_reports_missing_origin_master(monkeypatch, capsys):
    responses = iter(
        [
            result(),
            result(stdout="feature/worktree\n"),
            result(),
            result(returncode=1),
        ]
    )
    monkeypatch.setattr(git_sync, "run_git", lambda *args, **kwargs: next(responses))

    assert git_sync.main() == 1
    assert "origin/master was not found" in capsys.readouterr().err


def test_fetches_then_rebases_without_autostash(monkeypatch):
    calls = []
    responses = iter(
        [
            result(),
            result(stdout="feature/worktree\n"),
            result(),
            result(),
            result(),
        ]
    )

    def fake_run_git(*args, **kwargs):
        calls.append((args, kwargs))
        return next(responses)

    monkeypatch.setattr(git_sync, "run_git", fake_run_git)

    assert git_sync.main() == 0
    assert calls == [
        (("status", "--porcelain"), {"capture_output": True}),
        (("branch", "--show-current"), {"capture_output": True}),
        (("fetch", "--prune", "origin"), {}),
        (
            ("rev-parse", "--verify", "--quiet", "refs/remotes/origin/master"),
            {"capture_output": True},
        ),
        (("rebase", "--no-autostash", "origin/master"), {}),
    ]


def test_returns_rebase_failure_code(monkeypatch):
    responses = iter(
        [
            result(),
            result(stdout="feature/worktree\n"),
            result(),
            result(),
            result(returncode=23),
        ]
    )
    monkeypatch.setattr(git_sync, "run_git", lambda *args, **kwargs: next(responses))

    assert git_sync.main() == 23
