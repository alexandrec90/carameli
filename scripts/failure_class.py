"""Classify a failed tool's output: absent, broken, environmental, or a real finding.

Split out of ``diagnostics.py`` because that module was over the ``file_lines`` limit
and this is the seam its callers already use: ``lint-all.py``, ``run-tests.py`` and
``run-e2e.py`` all want the verdict, none of them wants the digest.

Pure and stdlib-only. Text matching is the mechanism of last resort -- prefer a
structural signal (``importlib.util.find_spec``, ``FileNotFoundError``) wherever the
caller has one, as devkit's own runner and its generated-project template both do. This
exists for the failures that arrive as output with no exception to catch, chiefly
``docker compose exec`` reporting from inside a container.
"""

_MISSING_TOOL = [
    "ModuleNotFoundError",
    "command not found",
    "not recognized",
    "is not installed",
    "Cannot find",
    "could not be found",
    # Docker's wording when `docker compose exec <svc> <cmd>` can't find the
    # binary inside the container (a `bash -c` wrapper says "command not found").
    "executable file not found",
]
# A tool that is present but cannot start is NOT a missing tool, and must not be skipped.
# These are load failures of a native binding or C extension: the package is installed,
# and the machine is missing a runtime it links against (on Windows, the MSVC
# redistributable). Classified as "not installed" they were skipped, and `digest_lint`
# leaves `any_failed` False for a skip -- so on 2026-09-05 `ship.py` printed
# `[skip] eslint (not installed)` followed by `LINT PASSED`, having linted nothing. A
# gate that reports green after running no checks is the failure this list exists to
# prevent; it is the same hole `CLAUDE.md` describes for a deleted `logs/` artifact.
#
# Checked BEFORE `_MISSING_TOOL`, because each of these also matches that list -- the
# Windows loader's "The specified module could not be found." tail most of all.
#
# Note what is deliberately absent: a bare `MODULE_NOT_FOUND` or "Cannot find module".
# Node prints both for a genuinely absent package, which *is* a missing tool, so
# matching them would turn every uninstalled node linter into a hard failure. knip is
# reached instead by `requireNative`, the napi loader frame, which appears only when a
# binding was found and failed to load.
#
# The better mechanism is devkit's: `templates/core/scripts/lint-all.py.tmpl` decides a
# tool is missing from `importlib.util.find_spec` and `FileNotFoundError` rather than
# from error text, and so cannot make this mistake. Text matching survives here only
# because `docker compose exec` failures reach us as output from another machine's
# shell, with no exception to catch. Prefer the structural signal wherever there is one.
_BROKEN_RUNTIME = [
    "Cannot find native binding",
    "DLL load failed",
    "requireNative",
]
# The DB guard in `tests/conftest.py`, which refuses to TRUNCATE a database nothing
# marks as disposable. It is environmental by every measure that matters here: it is a
# fact about `DATABASE_URL` on this machine, no change to the code under test can clear
# it, and it stops the session before a single test runs. Unclassified it was a bare
# non-zero exit with no parseable pytest output, so the artifact said "exit code
# indicated failure but no parseable lines" -- and the genuine hook-test failure in the
# same run was read as that one expected red and only surfaced from CI.
#
# Matched on the guard's own opening words rather than on `RuntimeError`, which is a
# perfectly ordinary thing for a real test to raise.
_DB_GUARD = "refusing to empty the database"

_ENV_ERROR = [
    _DB_GUARD,
    "ConnectionRefusedError",
    "InvalidPasswordError",
    "OperationalError",
    "authentication failed",
    "could not connect",
    "connection refused",
    "timeout expired",
    "Cannot connect to the Docker daemon",
    "No such container",
    "No such service",
    "is not running",
    "error during connect",
]


def get_skip_reason(lines: list[str]) -> str | None:
    """Return a skip reason for environmental / missing-tool failures, else None.

    These pollute the artifact with content the agent cannot fix, so the runners
    emit a one-line skip note to the terminal instead of writing a section.

    A broken *installed* tool is not one of them: it returns None so the failure keeps
    its section and its exit status, because a skipped linter is reported as a pass.
    """
    text = "\n".join(lines)
    if any(p in text for p in _BROKEN_RUNTIME):
        return None
    if any(p in text for p in _MISSING_TOOL):
        return "not installed"
    # Named rather than folded into "environment error", because the remedy is specific
    # and the guard already prints it: point DATABASE_URL at `carameli_test`, or set
    # CARAMELI_ALLOW_DB_TRUNCATE=1. A reader who sees the generic label goes looking for
    # a service that is down.
    if _DB_GUARD in text:
        return "the DB guard refused a non-disposable database"
    if any(p in text for p in _ENV_ERROR):
        return "environment error"
    return None
