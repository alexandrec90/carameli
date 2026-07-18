"""Invariants for using uv as the Python dependency installer.

uv (the same resolver that compiles the locks via `scripts/recompile-locks.py`)
is the installer across every environment that materializes the compiled locks:

  * the Docker image build (`Dockerfile`, builder + builder-test stages),
  * CI (`.github/actions/setup-python-env`), and
  * the local post-merge reinstall hook (`scripts/hooks/deps-sync.py`, covered
    by test_deps_sync.py).

These tests lock uv in so a careless edit can't silently reintroduce a plain
`pip install` of the locks -- which would drift the install path off the
resolver the locks were compiled with. Stdlib-only text parse (no PyYAML), so
they run in the hook-tests gate step before the venv is guaranteed, alongside
test_ci_workflow_conventions.py.
"""

from conftest import REPO_ROOT

DOCKERFILE = REPO_ROOT / "Dockerfile"
COMPOSITE = REPO_ROOT / ".github" / "actions" / "setup-python-env" / "action.yml"


def _read(path) -> str:
    return path.read_text(encoding="utf-8")


def test_dockerfile_installs_the_locks_with_uv():
    text = _read(DOCKERFILE)
    # uv is pulled from the pinned official image and drives both prefix installs.
    assert "COPY --from=ghcr.io/astral-sh/uv:" in text, (
        "Dockerfile should pull the uv binary from the pinned official image."
    )
    assert text.count("uv pip install") >= 2, (
        "both the runtime and test-deps stages should install via `uv pip install`."
    )
    # No stage may fall back to a bare `pip install -r requirements*.txt` of the
    # locks -- that would install with a resolver other than the one that
    # compiled them.
    assert "pip install --no-cache-dir --prefix=/install" not in text, (
        "Dockerfile still installs the locks with pip; use `uv pip install` instead."
    )


def test_composite_action_installs_the_locks_with_uv():
    text = _read(COMPOSITE)
    assert "uv pip install --system" in text, (
        "setup-python-env should install the locks via `uv pip install --system`."
    )
    # The installer version is single-sourced from the compiled dev lock (same
    # extraction the Dependabot lock-repair workflow uses), never hard-coded here.
    assert "uv==$uv_version" in text, (
        "the composite should install the uv version pinned in requirements-dev.txt, "
        "not a hard-coded one."
    )
    assert "pip install -r requirements.txt -r requirements-dev.txt" not in text, (
        "the composite still installs the locks with pip; use uv instead."
    )
