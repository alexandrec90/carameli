"""Unit tests for scripts/ship.py (pure helpers + push retry logic)."""

from conftest import load_module

ship = load_module("scripts/ship.py")


class TestIsShippable:
    def test_feature_branch_ok(self):
        ok, reason = ship.is_shippable("claude/add-sms-0722")
        assert ok is True
        assert reason == ""

    def test_master_rejected(self):
        ok, reason = ship.is_shippable("master")
        assert ok is False
        assert "master" in reason

    def test_detached_head_rejected(self):
        ok, reason = ship.is_shippable("")
        assert ok is False
        assert "detached" in reason.lower()

    def test_custom_default(self):
        ok, _ = ship.is_shippable("main", default="main")
        assert ok is False


class TestTreeClean:
    def test_empty_is_clean(self):
        assert ship.tree_clean("") is True
        assert ship.tree_clean("   \n  ") is True

    def test_changes_are_dirty(self):
        assert ship.tree_clean(" M app/main.py\n") is False


class TestBackoffDelays:
    def test_exponential_schedule(self):
        assert ship.backoff_delays() == [2, 4, 8, 16]


class TestParseLintOk:
    def test_zero_is_ok(self):
        assert ship.parse_lint_ok(0) is True

    def test_nonzero_is_failure(self):
        assert ship.parse_lint_ok(1) is False


class _Result:
    def __init__(self, returncode, stderr=""):
        self.returncode = returncode
        self.stderr = stderr


class TestPushRetry:
    def test_succeeds_first_try(self, monkeypatch):
        calls = []
        monkeypatch.setattr(ship, "_git", lambda *a: calls.append(a) or _Result(0))
        assert ship._push("b", sleep=lambda _s: None) is True
        assert len(calls) == 1

    def test_retries_transient_then_succeeds(self, monkeypatch):
        results = [_Result(1, "fatal: unable to connect: timed out"), _Result(0)]
        monkeypatch.setattr(ship, "_git", lambda *a: results.pop(0))
        slept = []
        assert ship._push("b", sleep=slept.append) is True
        assert slept == [2]  # one retry, first backoff delay

    def test_gives_up_after_all_retries(self, monkeypatch):
        monkeypatch.setattr(ship, "_git", lambda *a: _Result(1, "could not resolve host"))
        slept = []
        assert ship._push("b", sleep=slept.append) is False
        assert slept == [2, 4, 8, 16]  # full schedule exhausted

    def test_non_transient_failure_does_not_retry(self, monkeypatch):
        calls = []
        monkeypatch.setattr(
            ship, "_git", lambda *a: calls.append(a) or _Result(1, "rejected: non-fast-forward")
        )
        slept = []
        assert ship._push("b", sleep=slept.append) is False
        assert len(calls) == 1  # no retry on a non-network error
        assert slept == []


class TestShippedMarker:
    def _wire(self, monkeypatch, *, branch, lint_ok, push_ok, clean=True):
        monkeypatch.setattr(ship, "current_branch", lambda: branch)
        monkeypatch.setattr(ship, "_porcelain", lambda: "" if clean else " M x.py\n")
        monkeypatch.setattr(ship, "_run_lint", lambda: lint_ok)
        monkeypatch.setattr(ship, "_push", lambda b: push_ok)
        marked = []
        monkeypatch.setattr(ship, "write_shipped_marker", marked.append)
        return marked

    def test_marker_written_on_successful_ship(self, monkeypatch):
        marked = self._wire(monkeypatch, branch="claude/x-0722", lint_ok=True, push_ok=True)
        assert ship.main([]) == ship.EXIT_OK
        assert marked == ["claude/x-0722"]

    def test_marker_not_written_when_push_fails(self, monkeypatch):
        marked = self._wire(monkeypatch, branch="claude/x-0722", lint_ok=True, push_ok=False)
        assert ship.main([]) == ship.EXIT_PUSH_FAILED
        assert marked == []

    def test_marker_not_written_when_lint_fails(self, monkeypatch):
        marked = self._wire(monkeypatch, branch="claude/x-0722", lint_ok=False, push_ok=True)
        assert ship.main([]) == ship.EXIT_LINT_FAILED
        assert marked == []

    def test_preflight_does_not_write_marker(self, monkeypatch):
        marked = self._wire(monkeypatch, branch="claude/x-0722", lint_ok=True, push_ok=True)
        assert ship.main(["--preflight"]) == ship.EXIT_OK
        assert marked == []
