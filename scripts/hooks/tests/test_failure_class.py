"""Tests for scripts/failure_class.py -- the shared failure classifier."""

import failure_class as fc

# ---------------------------------------------------------------------------
# get_skip_reason
# ---------------------------------------------------------------------------


def test_get_skip_reason_missing_tool():
    assert fc.get_skip_reason(["command not found: ruff"]) == "not installed"


def test_get_skip_reason_docker_exec_missing_binary():
    # `docker compose exec app pytest` when the binary is missing from the
    # container fails with Docker's OCI wording, not bash's "command not found".
    line = (
        "OCI runtime exec failed: exec failed: unable to start container process: "
        'exec: "pytest": executable file not found in $PATH'
    )
    assert fc.get_skip_reason([line]) == "not installed"


def test_get_skip_reason_env_error():
    assert fc.get_skip_reason(["connection refused"]) == "environment error"


def test_get_skip_reason_real_error():
    assert fc.get_skip_reason(["app/main.py:10:1: F401 unused import"]) is None


# A tool that is installed but cannot start is not a missing tool. Each of these was
# classified "not installed" on 2026-09-05, which is what let `ship.py` print
# `[skip] eslint (not installed)` and then `LINT PASSED` while eslint could not run at
# all. The machine was missing the MSVC runtime the native bindings link against.


def test_get_skip_reason_eslint_broken_native_binding():
    # napi-rs's wording. Note it blames npm's optional-dependency bug, which was not the
    # cause: the binding package was installed and present on disk the whole time.
    line = (
        "Error: Cannot find native binding. npm has a bug related to optional "
        "dependencies (https://github.com/npm/cli/issues/4828)."
    )
    assert fc.get_skip_reason([line]) is None


def test_get_skip_reason_python_extension_dll_load_failure():
    line = (
        "ImportError: DLL load failed while importing _greenlet: "
        "The specified module could not be found."
    )
    assert fc.get_skip_reason([line]) is None


def test_get_skip_reason_knip_native_loader_frame():
    # knip's trace carries no "native binding" phrase — the only reliable marker is the
    # napi loader frame, above a message that reads as an ordinary missing module.
    lines = [
        "Error: Cannot find module 'C:/repo/frontend/node_modules/oxc-resolver/index.js'",
        "    at requireNative (C:/repo/frontend/node_modules/oxc-resolver/index.js:126:16)",
        "  code: 'MODULE_NOT_FOUND'",
    ]
    assert fc.get_skip_reason(lines) is None


def test_get_skip_reason_broken_runtime_outranks_missing_tool():
    # Both families match this text. The broken-runtime verdict has to win, or the
    # "could not be found" tail alone puts it back to "not installed".
    lines = [
        "ImportError: DLL load failed while importing _greenlet: "
        "The specified module could not be found.",
        "ModuleNotFoundError: No module named 'playwright'",
    ]
    assert fc.get_skip_reason(lines) is None


def test_get_skip_reason_empty():
    assert fc.get_skip_reason([]) is None


def test_the_db_guard_is_an_environment_skip_with_its_own_name():
    """The reported run had two red targets -- this expected refusal and a genuine
    hook-test failure -- and the artifact named neither, so the real one was read as
    the expected one and only surfaced from CI.

    Named rather than folded into "environment error": the remedy is specific and the
    guard already prints it, and a reader who sees the generic label goes looking for a
    service that is down.
    """
    lines = [
        "E   RuntimeError: refusing to empty the database 'carameli' on localhost:5432:",
        "E   the test session TRUNCATEs every table before it starts",
    ]
    assert fc.get_skip_reason(lines) == "the DB guard refused a non-disposable database"


def test_an_ordinary_runtime_error_is_not_the_db_guard():
    """Matched on the guard's own opening words, never on `RuntimeError` -- which is a
    perfectly ordinary thing for a real test to raise."""
    assert fc.get_skip_reason(["E   RuntimeError: the widget exploded"]) is None
