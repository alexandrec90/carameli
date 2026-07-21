#!/usr/bin/env python3
"""Stop dispatcher (portable replacement for copilot-settings-stop.ps1).

On every stop, best-effort and always exiting 0:
  - finalize state.json for the state-driven skills,
  - snapshot the optimize-fixers profile when present,
  - roll the just-ended session into skills-profile.json (archive-session.py),
  - normalize known-fixes tables when explicitly enabled,
  - typecheck the frontend when skin files changed.

Then a pre-stop verification phase (Tiers 1-3) reproduces the PR-gate checks
locally, scoped to the working-tree diff, and exits 2 to relay any failure back
into the session so it is fixed here instead of after a CI round-trip:
  - Tier 1: `lint-all.py --changed` (ruff/mypy/vulture/eslint/... , no infra),
  - Tier 2a: host `pytest scripts/hooks/tests/` when a scripts/ file changed --
    needs no Docker, so it runs even under a stack-down-by-default policy,
  - Tier 2b: `run-tests.py --fast` when app/ or tests/ Python changed and the app
    container is up (in-container, paid-safe via the global `-m "not paid"`
    default); skipped with the stack down (Postgres has no free substitute),
  - Tier 3: `check-lock-markers.py` when a requirements file changed, and vitest
    when frontend/src changed.
It is loop-guarded (`stop_hook_active`), opt-out-able (`CARAMELI_SKIP_STOP_VERIFY=1`),
gated on relevant files changing, and skips cleanly when tooling/infra is absent.

`save_snapshot`, `skin_changed`, `should_normalize`, `archive_targets_present`, and
the verification helpers (`stop_hook_active`, `verify_enabled`, `changed_paths`,
`select_checks`, `run_checks`) are pure and unit-tested
(`scripts/hooks/tests/test_stop.py`); each external step is its own importable,
independently tested script.
"""

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = (Path(__file__).parent / "../..").resolve()
PROFILE = REPO_ROOT / "logs/agent/skills-profile.json"
SNAPSHOT = REPO_ROOT / "logs/agent/skills-profile.optimized.json"

FINALIZE_STATE = REPO_ROOT / "scripts/hooks/finalize-state.py"
NORMALIZE_KNOWN_FIXES = REPO_ROOT / "scripts/hooks/normalize-known-fixes.py"
ARCHIVE_SESSION = REPO_ROOT / "scripts/hooks/archive-session.py"

# --- Pre-stop verification (Tiers 1-3) -------------------------------------
# Reproduce the PR-gate checks locally, scoped to the working-tree diff, so an
# agent fixes them in-session instead of after a CI round-trip. Each is gated on
# a relevant file changing; Tier 2 (tests) additionally requires the app
# container to be up; all skip cleanly when their tooling/infra is absent.
LINT_ALL = REPO_ROOT / "scripts/lint-all.py"
RUN_TESTS = REPO_ROOT / "scripts/run-tests.py"
CHECK_LOCK_MARKERS = REPO_ROOT / "scripts/check-lock-markers.py"

CHECK_LINT = "lint"  # Tier 1: lint-all.py --changed (no infra)
CHECK_SCRIPT_TESTS = "script-tests"  # Tier 2a: host pytest scripts/hooks/tests (no infra)
CHECK_TESTS = "tests"  # Tier 2b: run-tests.py --fast (needs app container; paid-safe)
CHECK_LOCKS = "lock-markers"  # Tier 3: check-lock-markers.py (deps changed)
CHECK_FRONTEND = "frontend"  # Tier 3: vitest (frontend/src changed)

_REQ_RE = re.compile(r"(^|/)requirements[^/]*\.(in|txt)$")

# Opt-out: set to "1" to skip pre-stop verification entirely.
SKIP_VERIFY_ENV = "CARAMELI_SKIP_STOP_VERIFY"

# (skill, schema) pairs finalized on every stop. Safe to call when artifacts are
# absent: finalize-state.py exits 0 in that case.
FINALIZE_TARGETS = (
    ("audit-design-flaws", "audit"),
    ("make-tests", "modules"),
    ("make-frontend-tests", "modules"),
    ("refactor", "files"),
)


def save_snapshot(profile: Path, snapshot: Path) -> int:
    """Copy `profile` to `snapshot` if it exists. Returns process exit code."""
    if not profile.exists():
        return 0
    try:
        shutil.copy2(profile, snapshot)
    except OSError as exc:
        print(f"stop.py: could not save optimize-fixers snapshot: {exc}", file=sys.stderr)
        return 1
    return 0


def should_normalize(env: dict[str, str]) -> bool:
    """True when known-fixes normalization is explicitly enabled."""
    return env.get("CARAMELI_NORMALIZE_KNOWN_FIXES_ON_STOP") == "1"


def archive_targets_present(raw_stdin: str) -> bool:
    """True when the Stop payload names a transcript worth archiving.

    archive-session.py self-guards on a missing transcript, but checking here
    avoids spawning a Python process for the common no-transcript stop.
    """
    try:
        payload = json.loads(raw_stdin)
    except (json.JSONDecodeError, TypeError):
        return False
    return bool(isinstance(payload, dict) and payload.get("transcript_path"))


def _read_stdin() -> str:
    """Best-effort read of the hook payload; '' when stdin is a tty or unreadable."""
    try:
        if sys.stdin is None or sys.stdin.isatty():
            return ""
        return sys.stdin.read()
    except (OSError, ValueError):
        return ""


def skin_changed(porcelain: str) -> bool:
    """True when `git status --porcelain -- frontend/src/skins` reported changes."""
    return any(line.strip() for line in porcelain.splitlines())


def _git_skin_status(repo_root: Path) -> str:
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain", "--", "frontend/src/skins"],
            cwd=repo_root,
            capture_output=True,
            text=True,
        )
    except OSError:
        return ""
    return result.stdout if result.returncode == 0 else ""


# --- Pre-stop verification helpers (pure; unit-tested in test_stop.py) ------


def stop_hook_active(raw_stdin: str) -> bool:
    """True when this stop is already a continuation triggered by a stop hook.

    Claude Code sets `stop_hook_active` on the payload once a Stop hook has
    blocked and the agent resumed. Honouring it prevents an infinite
    fix -> stop -> block loop: verification runs on the first stop only.
    """
    try:
        payload = json.loads(raw_stdin)
    except (json.JSONDecodeError, TypeError):
        return False
    return bool(isinstance(payload, dict) and payload.get("stop_hook_active"))


def verify_enabled(env: dict[str, str]) -> bool:
    """False when the operator has opted out of pre-stop verification."""
    return env.get(SKIP_VERIFY_ENV) != "1"


def changed_paths(porcelain: str) -> list[str]:
    """Repo-relative paths from `git status --porcelain` (handles renames/quotes)."""
    paths: list[str] = []
    for line in porcelain.splitlines():
        if not line.strip():
            continue
        rest = line[3:] if len(line) > 3 else line.strip()
        if " -> " in rest:  # rename: "R  old -> new" -> keep the new path
            rest = rest.split(" -> ", 1)[1]
        paths.append(rest.strip().strip('"'))
    return paths


def _is_py(path: str) -> bool:
    return path.endswith((".py", ".pyi"))


def _is_frontend(path: str) -> bool:
    return path.startswith("frontend/src/")


def _is_reqs(path: str) -> bool:
    return bool(_REQ_RE.search(path))


def _is_script(path: str) -> bool:
    """A Python file under scripts/ -- covered by the infra-free host test suite."""
    return path.startswith("scripts/") and _is_py(path)


def _is_app_or_tests(path: str) -> bool:
    """A Python file whose tests need Postgres (the DB-backed, in-container tier)."""
    return _is_py(path) and (path.startswith("app/") or path.startswith("tests/"))


def select_checks(paths: list[str], stack_up: bool) -> list[str]:
    """Decide which verification checks to run for this diff.

    - lint runs whenever anything changed (lint-all.py --changed self-scopes
      internally, so an irrelevant edit is a fast no-op).
    - script-tests (host pytest scripts/hooks/tests) run when a scripts/ file
      changed. These need NO Docker, so they run even with the stack down --
      the recoverable slice under a stack-down-by-default policy.
    - tests (in-container, DB-backed) run only when app/ or tests/ Python
      changed AND the app container is up (Postgres has no free substitute).
      The runner inherits the global `-m "not paid"` exclusion, so it can never
      bill a live provider; with the stack down it is skipped (deferred to CI).
    - lock-markers run when a requirements file changed.
    - frontend (vitest) runs when frontend/src changed; tsc/eslint are already
      covered by lint's changed-scope, so this adds only the unit tests.
    """
    if not paths:
        return []
    checks = [CHECK_LINT]
    if any(_is_script(p) for p in paths):
        checks.append(CHECK_SCRIPT_TESTS)
    if stack_up and any(_is_app_or_tests(p) for p in paths):
        checks.append(CHECK_TESTS)
    if any(_is_reqs(p) for p in paths):
        checks.append(CHECK_LOCKS)
    if any(_is_frontend(p) for p in paths):
        checks.append(CHECK_FRONTEND)
    return checks


def _git_status_porcelain(repo_root: Path) -> str:
    try:
        result = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=repo_root,
            capture_output=True,
            text=True,
        )
    except OSError:
        return ""
    return result.stdout if result.returncode == 0 else ""


def stack_app_running(repo_root: Path = REPO_ROOT) -> bool:
    """True when the compose `app` service is running (Tier 2 gate).

    Probes only when a Python file changed. A stopped Docker daemon, missing
    compose, or a timeout all return False so tests skip cleanly (deferred to
    CI) rather than relaying an infra failure as a code failure.
    """
    try:
        result = subprocess.run(
            ["docker", "compose", "ps", "--services", "--status", "running"],
            cwd=repo_root,
            capture_output=True,
            text=True,
            timeout=15,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    if result.returncode != 0:
        return False
    return "app" in result.stdout.split()


def _command_for(name: str) -> tuple[list[str], Path, str | None] | None:
    """(argv, cwd, artifact_path) for a check, or None when its tool is absent."""
    if name == CHECK_LINT:
        return ([sys.executable, str(LINT_ALL), "--changed"], REPO_ROOT, "logs/lint-errors.log")
    if name == CHECK_SCRIPT_TESTS:
        return ([sys.executable, "-m", "pytest", "scripts/hooks/tests/", "-q"], REPO_ROOT, None)
    if name == CHECK_TESTS:
        return ([sys.executable, str(RUN_TESTS), "--fast"], REPO_ROOT, "logs/test-failures.log")
    if name == CHECK_LOCKS:
        return ([sys.executable, str(CHECK_LOCK_MARKERS)], REPO_ROOT, None)
    if name == CHECK_FRONTEND:
        npm = shutil.which("npm")
        if not npm:
            return None
        return ([npm, "run", "test:run"], REPO_ROOT / "frontend", None)
    return None


def run_checks(names: list[str]) -> list[tuple[str, str | None, str]]:
    """Run selected checks; return (name, artifact, tail) for each that failed.

    A missing tool or an OS error is a skip, never a failure: verification must
    never block the agent because of a local tooling gap.
    """
    failures: list[tuple[str, str | None, str]] = []
    for name in names:
        spec = _command_for(name)
        if spec is None:
            continue
        argv, cwd, artifact = spec
        try:
            result = subprocess.run(argv, cwd=cwd, capture_output=True, text=True)
        except OSError:
            continue
        if result.returncode != 0:
            tail = (result.stdout + result.stderr).strip().splitlines()[-15:]
            failures.append((name, artifact, "\n".join(tail)))
    return failures


def _print_verify_failures(failures: list[tuple[str, str | None, str]]) -> None:
    lines = ["Pre-stop verification found issues that would fail CI -- fix before finishing:"]
    for name, artifact, tail in failures:
        if artifact and (REPO_ROOT / artifact).exists():
            lines.append(f"  - {name}: see {artifact}")
        else:
            lines.append(f"  - {name}:")
            if tail:
                lines.extend(f"      {ln}" for ln in tail.splitlines())
    lines.append(
        "Re-run locally: python scripts/lint-all.py --changed | python scripts/run-tests.py --fast"
    )
    lines.append(f"(Set {SKIP_VERIFY_ENV}=1 to skip this gate.)")
    print("\n".join(lines), file=sys.stderr)


def verify(raw_stdin: str, env: dict[str, str]) -> int:
    """Run pre-stop verification. Returns 2 (block, relay) on failure, else 0."""
    if stop_hook_active(raw_stdin) or not verify_enabled(env):
        return 0
    paths = changed_paths(_git_status_porcelain(REPO_ROOT))
    # Only probe Docker when a DB-backed test could run -- a scripts/ or docs-only
    # change never needs the stack, so it must not pay the probe cost.
    stack_up = stack_app_running() if any(_is_app_or_tests(p) for p in paths) else False
    failures = run_checks(select_checks(paths, stack_up))
    if failures:
        _print_verify_failures(failures)
        return 2
    return 0


def main() -> int:
    raw_stdin = _read_stdin()

    # State-driven skills: safe to call every stop.
    for skill, schema in FINALIZE_TARGETS:
        subprocess.run(
            [sys.executable, str(FINALIZE_STATE), "--skill", skill, "--schema", schema],
            cwd=REPO_ROOT,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    # Snapshot the *current* profile as the optimize-fixers baseline, THEN roll the
    # just-ended session into the profile. This ordering leaves the profile ahead of
    # the snapshot by this session, so /optimize-fixers sees a non-empty delta.
    save_snapshot(PROFILE, SNAPSHOT)

    if archive_targets_present(raw_stdin):
        subprocess.run(
            [sys.executable, str(ARCHIVE_SESSION)],
            cwd=REPO_ROOT,
            input=raw_stdin,
            text=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    if should_normalize(os.environ):
        subprocess.run(
            [sys.executable, str(NORMALIZE_KNOWN_FIXES)],
            cwd=REPO_ROOT,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

    if skin_changed(_git_skin_status(REPO_ROOT)):
        npm = shutil.which("npm")
        if npm:
            subprocess.run(
                [npm, "run", "typecheck"],
                cwd=REPO_ROOT / "frontend",
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )

    # Pre-stop verification runs last: it may exit 2 to block the stop and relay
    # failures back into the session. All best-effort side effects above have
    # already run and always exit 0, so a blocked stop never loses that work.
    return verify(raw_stdin, os.environ)


if __name__ == "__main__":
    sys.exit(main())
