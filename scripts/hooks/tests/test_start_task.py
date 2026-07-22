"""Unit tests for scripts/start-task.py (the /task entry point)."""

from conftest import load_module

start_task = load_module("scripts/start-task.py")


class TestBlockedReason:
    def test_clean_tree_is_clear(self):
        assert start_task.blocked_reason(tree_dirty=False) == ""

    def test_dirty_tree_is_blocked(self):
        reason = start_task.blocked_reason(tree_dirty=True)
        assert reason
        assert "/ship" in reason


class _Result:
    def __init__(self, returncode, stdout="", stderr=""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


class TestMain:
    def test_refuses_dirty_tree(self, monkeypatch):
        monkeypatch.setattr(start_task, "_tree_dirty", lambda: True)
        called = []
        monkeypatch.setattr(start_task, "_git", lambda *a, **k: called.append(a) or _Result(0))
        assert start_task.main(["fix", "the", "thing"]) == start_task.EXIT_DIRTY_TREE
        assert called == []  # bailed before touching git

    def test_missing_upstream_after_fetch(self, monkeypatch):
        monkeypatch.setattr(start_task, "_tree_dirty", lambda: False)

        def fake_git(*args, **kwargs):
            if args[0] == "rev-parse":
                return _Result(1)  # origin/master not found
            return _Result(0)

        monkeypatch.setattr(start_task, "_git", fake_git)
        assert start_task.main(["x"]) == start_task.EXIT_NO_UPSTREAM

    def test_happy_path_creates_branch(self, monkeypatch):
        monkeypatch.setattr(start_task, "_tree_dirty", lambda: False)
        monkeypatch.setattr(start_task, "_existing_branches", lambda: set())
        checkout = {}

        def fake_git(*args, **kwargs):
            if args[0] == "rev-parse":
                return _Result(0)
            if args[0] == "checkout":
                checkout["argv"] = args
                return _Result(0)
            return _Result(0)

        monkeypatch.setattr(start_task, "_git", fake_git)
        assert start_task.main(["add", "sms", "retry"]) == start_task.EXIT_OK
        # branch name is slugified from the description and based on origin/master
        assert checkout["argv"][0] == "checkout"
        assert checkout["argv"][1] == "-b"
        assert checkout["argv"][2].startswith("claude/add-sms-retry-")
        assert checkout["argv"][3] == "origin/master"

    def test_checkout_failure_propagates(self, monkeypatch):
        monkeypatch.setattr(start_task, "_tree_dirty", lambda: False)
        monkeypatch.setattr(start_task, "_existing_branches", lambda: set())

        def fake_git(*args, **kwargs):
            if args[0] == "rev-parse":
                return _Result(0)
            if args[0] == "checkout":
                return _Result(1, stderr="fatal: boom")
            return _Result(0)

        monkeypatch.setattr(start_task, "_git", fake_git)
        assert start_task.main(["x"]) == start_task.EXIT_CHECKOUT_FAILED
