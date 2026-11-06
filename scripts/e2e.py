#!/usr/bin/env python3
"""Carameli's local end-to-end tier: every test marked `local`, on a stack of its own.

The contract is `.claude/rules/local-e2e.md`: exit 0 green, anything else red, each
failure a `FAILED <id>` line, and a run that executed nothing is red. devkit's nightly
`devkit-local-e2e` job runs this in the primary checkout; a fixer runs it in a worktree.

**It owns its whole environment**, because the night has nobody to start anything and
`devkit-docker-stop-idle` has usually parked the stack by then. So it provisions the
checkout, installs the browsers, starts a Compose project of its own, migrates it from
nothing, serves the frontend from a host Vite, runs the tier, and deletes all of it. The
project is always `PROJECT`, with ports it just found free, so it cannot collide with
the stack someone is working in, and the `down -v` it ends on cannot reach that stack's
volumes. `tests/e2e/docker-compose.e2e.yml` keeps `.env`, and so every provider
credential, out of it.

**A skip is a failure here whoever runs it.** devkit's own script forgives skips by hand
because its tests want the static checkout, which a box is not. Nothing in this tier
wants anything this script does not start, so a skip is always this script or the
machine having failed, and `DEVKIT_E2E` changes nothing.

**What is deliberately not in the tier**, since "a test that needs this machine" could
read as covering them:

| Tests | Why not |
| --- | --- |
| `tests/live_e2e`, sandbox, chargeable | `paid`: they spend real money, opt-in only |
| `tests/integration/test_webhook_e2e.py` | needs a public tunnel to a running stack |
| `tests/local_e2e` (`scripts/local-e2e.py`) | needs a LegacyCRM checkout in IIS, not here |

Three similar names, three things: `scripts/run-e2e.py` runs `tests/e2e` against servers
you started and reports them unreachable as a skip; `scripts/local-e2e.py` and
`scripts/run-local-e2e.py` are the LegacyCRM integration.

Failures go to `logs/e2e-junit.xml`, with the stack's own output in `logs/e2e-stack.log`
and the dev server's in `logs/e2e-vite.log`.

Named test ids run those alone, still inside the tier:
`python scripts/e2e.py tests/e2e/test_smoke.py::test_app_loads`

Stdlib only until it has provisioned the checkout, as a task's script must be.
Tested in `scripts/hooks/tests/test_e2e.py`.
"""

from __future__ import annotations

import os
import secrets
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree

import node_runtime
import script_common

REPO_ROOT = Path(__file__).resolve().parents[1]

# The only project this script ever names. The `down -v` below deletes volumes, so it is
# a constant and not something derived from `.env` or the checkout.
PROJECT = "carameli-e2e"
COMPOSE_FILES = ("docker-compose.yml", "tests/e2e/docker-compose.e2e.yml")
SERVICES = ("app", "minio")

MARKER = "local and not paid"
SUITES = (
    "tests/e2e",
    "tests/integration/test_s3_storage.py",
    "tests/integration/test_stack_e2e.py",
)
BROWSERS = ("chromium", "firefox", "webkit")

LOOPBACK = "127.0.0.1"
LOGS = Path("logs")
JUNIT = LOGS / "e2e-junit.xml"
STACK_LOG = LOGS / "e2e-stack.log"
VITE_LOG = LOGS / "e2e-vite.log"

UP_TIMEOUT_S = 300
VITE_TIMEOUT_S = 120.0
POLL_INTERVAL_S = 1.0
VITE_STOP_TIMEOUT_S = 10

# A job with no console would otherwise open one window per child.
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


@dataclass(frozen=True)
class Case:
    """One test from the junit report: `tests/x.py::name`, and how it ended."""

    ident: str
    outcome: str  # "passed", "failed", "error" or "skipped"
    message: str = ""


@dataclass(frozen=True)
class Ports:
    """Where this run's stack and dev server listen, all found free just now."""

    app: int
    minio: int
    vite: int


def free_port() -> int:
    """A port nothing is listening on, which the OS picked."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind((LOOPBACK, 0))
        return int(probe.getsockname()[1])


def compose(*args: str) -> list[str]:
    """`docker compose` on this tier's project and files, and on nothing else."""
    files = [flag for name in COMPOSE_FILES for flag in ("-f", name)]
    return ["docker", "compose", "-p", PROJECT, *files, *args]


def reset_argv() -> list[str]:
    """Delete the project, volumes included: the first step and the last."""
    return compose("down", "-v", "--remove-orphans")


def up_argv() -> list[str]:
    return compose("up", "-d", "--build", "--wait", "--wait-timeout", str(UP_TIMEOUT_S), *SERVICES)


def buckets_argv() -> list[str]:
    """The one-shot that creates MinIO's buckets, run here and not named to `up`.

    `up --wait` calls any container that exits a failure, exit 0 included, so a one-shot
    among its services fails the step having done its job.
    """
    return compose("run", "--rm", "-T", "minio-init")


def migrate_argv() -> list[str]:
    return compose("exec", "-T", "app", "alembic", "upgrade", "head")


def stack_env(base: dict[str, str], ports: Ports, api_key: str) -> dict[str, str]:
    """`base` with what Compose interpolates and what the tests read.

    `COMPOSE_PROFILES` is emptied because a checkout's `.env` may enable `telephony`, and
    `COMPOSE_PROJECT_NAME` set because `.env` names the checkout's own project and the
    app's image tag is built from it. The process environment beats that file for both.
    The `S3_*` values override whatever the shell carries, since the tests read those
    first; MinIO's are the compose file's own throwaway defaults.
    """
    return {
        **base,
        "COMPOSE_PROJECT_NAME": PROJECT,
        "COMPOSE_PROFILES": "",
        "E2E_API_KEY": api_key,
        "E2E_APP_PORT": str(ports.app),
        "E2E_MINIO_PORT": str(ports.minio),
        "E2E_BACKEND_URL": f"http://{LOOPBACK}:{ports.app}",
        "E2E_BASE_URL": f"http://{LOOPBACK}:{ports.vite}",
        "S3_ENDPOINT": f"http://{LOOPBACK}:{ports.minio}",
        "S3_ACCESS_KEY_ID": "minioadmin",
        "S3_SECRET_ACCESS_KEY": "minioadmin",  # pragma: allowlist secret
        "S3_BUCKET": "carameli-recordings",
        "S3_REGION": "us-east-1",
        "PYTHONIOENCODING": "utf-8",
    }


def vite_env(env: dict[str, str], ports: Ports) -> dict[str, str]:
    """The dev server's settings: this run's ports, and always the demo build."""
    return {
        **env,
        "VITE_PORT": str(ports.vite),
        "VITE_PROXY_TARGET": f"http://{LOOPBACK}:{ports.app}",
        "VITE_LIVE_BACKEND": "false",
    }


def vite_argv(node: str, port: int) -> list[str]:
    """Vite itself rather than `npm run dev`: one process, so stopping it stops it."""
    script = str(Path("node_modules") / "vite" / "bin" / "vite.js")
    return [node, script, "--host", LOOPBACK, "--port", str(port), "--strictPort"]


def pytest_argv(python: str, report: Path, named: Sequence[str] = ()) -> list[str]:
    """pytest over the tier. `SUITES` are named because `addopts` ignores `tests/e2e`."""
    return [
        python,
        "-m",
        "pytest",
        *(named or SUITES),
        "-m",
        MARKER,
        *(f"--browser={browser}" for browser in BROWSERS),
        "-q",
        "--tb=short",
        "--color=no",
        "-rfE",
        "-p",
        "no:cacheprovider",
        f"--junitxml={report}",
    ]


def failure_line(step: str, detail: str) -> str:
    """A `FAILED` line for a step that is no test, so it signs the run like any failure."""
    lines = detail.strip().splitlines()
    return f"FAILED scripts/e2e.py::{step} - {lines[-1] if lines else 'no output'}"


def _test_id(classname: str, name: str) -> str:
    """pytest's `tests/x.py::Class::name` from junit's dotted `tests.x.Class` and name."""
    parts = classname.split(".")
    modules = [index for index, part in enumerate(parts) if part.startswith("test_")]
    if not modules:
        return "::".join(part for part in (classname, name) if part)
    end = modules[0] + 1
    return "::".join(["/".join(parts[:end]) + ".py", *parts[end:], name])


def cases(report: Path) -> list[Case]:
    """Every case in a junit report. Unreadable is none, which `verdict` calls a red run."""
    try:
        # pytest's own report on this machine, read straight after pytest wrote it.
        root = ElementTree.parse(report).getroot()  # noqa: S314 - local, self-produced file
    except (OSError, ElementTree.ParseError):
        return []
    found: list[Case] = []
    for case in root.iter("testcase"):
        ident = _test_id(case.get("classname", ""), case.get("name", "?"))
        ended = next(iter(case.findall("failure") + case.findall("error")), None)
        skipped = case.find("skipped")
        if ended is not None:
            outcome = "failed" if ended.tag == "failure" else "error"
            found.append(Case(ident, outcome, ended.get("message", "")))
        elif skipped is not None:
            found.append(Case(ident, "skipped", skipped.get("message", "")))
        else:
            found.append(Case(ident, "passed"))
    return found


def _first_line(text: str, fallback: str) -> str:
    return next(iter(text.strip().splitlines()), fallback)


def verdict(code: int, found: Sequence[Case]) -> tuple[int, list[str]]:
    """`(exit code, lines to print)` for pytest's `code` and the cases it reported.

    pytest printed its own `FAILED` lines. A setup error prints as `ERROR`, which the
    fix pass does not read, and a skip prints as nothing, so both are added here.
    """
    lines = [
        f"FAILED {case.ident} - {case.outcome}: {_first_line(case.message, 'no reason')}"
        for case in found
        if case.outcome in ("error", "skipped")
    ]
    if not [case for case in found if case.outcome in ("passed", "failed")]:
        lines.append(f"e2e: no {MARKER!r} test executed, which is not a pass")
        return (code or 1), lines
    if any(case.outcome == "skipped" for case in found):
        lines.append("e2e: this tier starts everything it needs, so a skip is a failure")
        return (code or 1), lines
    return code, lines


def run(argv: Sequence[str], env: dict[str, str], *, echo: bool = True) -> tuple[int, str]:
    """Run `argv`, echoing its output as it comes. `(exit code, output)`, never raises.

    Captured and re-printed rather than inherited: a `CREATE_NO_WINDOW` child writes
    inherited output to the hidden console it was given, not the pipe the pass reads.
    `echo=False` is for output that belongs in a file: the pass reads every `FAILED` line
    on this stream as a failing test, whoever printed it.
    """
    print(f"e2e: {' '.join(argv)}", flush=True)
    try:
        proc = subprocess.Popen(
            list(argv),
            cwd=REPO_ROOT,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            creationflags=NO_WINDOW,
        )
    except OSError as exc:
        return 127, f"could not start {argv[0]}: {exc}"
    lines: list[str] = []
    if proc.stdout is not None:
        for line in iter(proc.stdout.readline, ""):
            if echo:
                print(line, end="", flush=True)
            lines.append(line)
    return proc.wait(), "".join(lines)


def answers(url: str) -> bool:
    """True once `url` responds at all, an error status included."""
    try:
        with urllib.request.urlopen(url, timeout=5):
            return True
    except urllib.error.HTTPError:
        return True
    except OSError:
        return False


def wait_until(check, timeout_s: float, interval_s: float = POLL_INTERVAL_S) -> bool:
    """Poll `check` until it is true or the budget runs out. One last try at the end."""
    deadline = time.monotonic() + timeout_s
    while not check():
        if time.monotonic() >= deadline:
            return bool(check())
        time.sleep(interval_s)
    return True


def provision(env: dict[str, str]) -> str | None:
    """Make the checkout able to run the tier. None when it can, else the failure line."""
    script = str(REPO_ROOT / "scripts" / "bootstrap.py")
    code, output = run([sys.executable, script], env)
    if code != 0:
        return failure_line("provision", output)
    python = str(script_common.venv_exe("python"))
    code, output = run([python, "-m", "playwright", "install", *BROWSERS], env)
    return failure_line("browsers", output) if code != 0 else None


def start_stack(env: dict[str, str]) -> str | None:
    """Bring the project up and migrate it. None when it stands, else the failure line.

    Resets first, because a run the pass killed at its timeout leaves its project behind.
    """
    steps = (
        ("reset", reset_argv()),
        ("up", up_argv()),
        ("buckets", buckets_argv()),
        ("migrate", migrate_argv()),
    )
    for step, argv in steps:
        code, output = run(argv, env)
        if code != 0:
            return failure_line(step, output)
    return None


def start_vite(env: dict[str, str], ports: Ports, log: Path) -> subprocess.Popen[bytes] | None:
    """Start the dev server, logging to `log`. None when no `node` could be found."""
    node = shutil.which("node", path=env.get("PATH"))
    if node is None:
        return None
    with log.open("wb") as sink:
        return subprocess.Popen(
            vite_argv(node, ports.vite),
            cwd=REPO_ROOT / "frontend",
            env=vite_env(env, ports),
            stdout=sink,
            stderr=subprocess.STDOUT,
            creationflags=NO_WINDOW,
        )


def stop_vite(proc: subprocess.Popen[bytes]) -> None:
    proc.terminate()
    try:
        proc.wait(VITE_STOP_TIMEOUT_S)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(VITE_STOP_TIMEOUT_S)


def run_tier(env: dict[str, str], ports: Ports, report: Path, named: Sequence[str]) -> int:
    """Serve the frontend, run pytest, stop the server. Prints what it found; the exit."""
    vite = start_vite(env, ports, REPO_ROOT / VITE_LOG)
    if vite is None:
        print(failure_line("vite", "no node on PATH; run scripts/bootstrap.py"), flush=True)
        return 1
    try:
        url = env["E2E_BASE_URL"]
        if not wait_until(lambda: answers(url), VITE_TIMEOUT_S):
            print(failure_line("vite", f"{url} never answered; see {VITE_LOG}"), flush=True)
            return 1
        python = str(script_common.venv_exe("python"))
        code, _ = run(pytest_argv(python, report, named), env)
    finally:
        stop_vite(vite)
    code, lines = verdict(code, cases(report))
    for line in lines:
        print(line, flush=True)
    return code


def keep_stack_log(env: dict[str, str], root: Path = REPO_ROOT) -> None:
    """Save the stack's own output to `STACK_LOG`, before the teardown deletes it."""
    code, output = run(compose("logs", "--no-color", "--timestamps"), env, echo=False)
    (root / STACK_LOG).write_text(f"exit {code}\n{output}", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    named = list(sys.argv[1:] if argv is None else argv)
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")

    report = REPO_ROOT / JUNIT
    report.parent.mkdir(parents=True, exist_ok=True)
    report.unlink(missing_ok=True)

    ports = Ports(free_port(), free_port(), free_port())
    env = stack_env(dict(os.environ), ports, secrets.token_hex(24))

    failure = provision(env)
    if failure:
        print(failure, flush=True)
        return 1
    node_runtime.activate(REPO_ROOT, env)

    code = 1
    try:
        failure = start_stack(env)
        if failure:
            print(failure, flush=True)
        else:
            code = run_tier(env, ports, report, named)
    finally:
        if code != 0:
            keep_stack_log(env)
        run(reset_argv(), env)
    print("LOCAL E2E PASSED" if code == 0 else "LOCAL E2E FAILED", flush=True)
    return code


if __name__ == "__main__":
    sys.exit(main())
