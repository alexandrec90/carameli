"""Tests for scripts/notify.py and scripts/notify-wrap.py."""
import subprocess
import sys
from unittest.mock import MagicMock, patch

from conftest import load_module

notify_mod = load_module("scripts/notify.py")
wrap_mod = load_module("scripts/notify-wrap.py")


# ---------------------------------------------------------------------------
# notify.py
# ---------------------------------------------------------------------------

def test_notify_noops_on_non_windows(monkeypatch):
    monkeypatch.setattr(sys, "platform", "linux")
    # Should not raise even if win11toast is absent
    notify_mod.notify("title", "message")


def test_notify_noops_when_win11toast_missing(monkeypatch):
    monkeypatch.setattr(sys, "platform", "win32")
    with patch.dict(sys.modules, {"win11toast": None}):
        notify_mod.notify("title", "message")  # must not raise


def test_notify_calls_toast_on_windows(monkeypatch):
    monkeypatch.setattr(sys, "platform", "win32")
    mock_toast = MagicMock()
    fake_win11toast = MagicMock()
    fake_win11toast.toast = mock_toast
    with patch.dict(sys.modules, {"win11toast": fake_win11toast}):
        notify_mod.notify("Tests passed", "12s")
    mock_toast.assert_called_once_with("Tests passed", "12s")


def test_notify_swallows_toast_exceptions(monkeypatch):
    monkeypatch.setattr(sys, "platform", "win32")
    fake_win11toast = MagicMock()
    fake_win11toast.toast.side_effect = RuntimeError("COM error")
    with patch.dict(sys.modules, {"win11toast": fake_win11toast}):
        notify_mod.notify("title", "message")  # must not raise


# ---------------------------------------------------------------------------
# notify-wrap.py
# ---------------------------------------------------------------------------

def _run_wrap(argv: list[str], *, elapsed: float = 1.0) -> int:
    """Invoke wrap_mod.main() with the given sys.argv and a fixed elapsed time."""
    with (
        patch.object(sys, "argv", ["notify-wrap.py"] + argv),
        patch("subprocess.run", return_value=MagicMock(returncode=0)) as mock_run,
        patch("time.monotonic", side_effect=[0.0, elapsed]),
        patch.object(wrap_mod, "notify") as mock_notify,
    ):
        code = wrap_mod.main()
    return code, mock_run, mock_notify


def test_wrap_missing_separator_returns_error():
    with patch.object(sys, "argv", ["notify-wrap.py", "My Task"]):
        assert wrap_mod.main() == 2


def test_wrap_empty_title_returns_error():
    with patch.object(sys, "argv", ["notify-wrap.py", "--", "python", "script.py"]):
        assert wrap_mod.main() == 2


def test_wrap_runs_command_and_forwards_exit_code():
    with (
        patch.object(sys, "argv", ["notify-wrap.py", "My Task", "--", "python", "ok.py"]),
        patch("subprocess.run", return_value=MagicMock(returncode=42)) as mock_run,
        patch("time.monotonic", side_effect=[0.0, 5.0]),
        patch.object(wrap_mod, "notify"),
    ):
        code = wrap_mod.main()
    assert code == 42
    mock_run.assert_called_once_with(["python", "ok.py"])


def test_wrap_notifies_passed_on_zero_exit():
    with (
        patch.object(sys, "argv", ["notify-wrap.py", "Test: Run pytest", "--", "python", "run.py"]),
        patch("subprocess.run", return_value=MagicMock(returncode=0)),
        patch("time.monotonic", side_effect=[0.0, 9.0]),
        patch.object(wrap_mod, "notify") as mock_notify,
    ):
        wrap_mod.main()
    mock_notify.assert_called_once()
    title, message = mock_notify.call_args.args
    assert "passed" in message.lower()
    assert "9s" in message


def test_wrap_notifies_failed_on_nonzero_exit():
    with (
        patch.object(sys, "argv", ["notify-wrap.py", "Test: Run pytest", "--", "python", "run.py"]),
        patch("subprocess.run", return_value=MagicMock(returncode=1)),
        patch("time.monotonic", side_effect=[0.0, 3.0]),
        patch.object(wrap_mod, "notify") as mock_notify,
    ):
        wrap_mod.main()
    mock_notify.assert_called_once()
    _, message = mock_notify.call_args.args
    assert "failed" in message.lower()


def test_wrap_elapsed_minutes_format():
    with (
        patch.object(sys, "argv", ["notify-wrap.py", "Lint", "--", "python", "lint.py"]),
        patch("subprocess.run", return_value=MagicMock(returncode=0)),
        patch("time.monotonic", side_effect=[0.0, 75.0]),
        patch.object(wrap_mod, "notify") as mock_notify,
    ):
        wrap_mod.main()
    _, message = mock_notify.call_args.args
    assert "1m" in message and "15s" in message


def test_wrap_title_from_multiple_words():
    with (
        patch.object(sys, "argv", ["notify-wrap.py", "Test:", "Run", "pytest", "--", "python", "x.py"]),
        patch("subprocess.run", return_value=MagicMock(returncode=0)),
        patch("time.monotonic", side_effect=[0.0, 1.0]),
        patch.object(wrap_mod, "notify") as mock_notify,
    ):
        wrap_mod.main()
    title, _ = mock_notify.call_args.args
    assert title == "Test: Run pytest"
