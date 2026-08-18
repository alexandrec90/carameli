#!/usr/bin/env python3
"""One command that brings up both sides of the local integration and runs it end to end.

``scripts/run-local-e2e.py`` runs the pytest suite and nothing else: it assumes IIS is
already serving VanillaSoft's VoipApi, that the SQL/Elasticsearch containers are up, and
that Carameli is answering. When any of those is false the suite fails with a connection
error, and the reader has to know which of four services to go start. This script owns
that sequencing instead — boot VanillaSoft, boot Carameli, run the suite, run the .NET
outbound driver — and reports the whole thing as one artifact.

**Stdlib only, and no virtualenv.** devkit's VS Code task dispatcher invokes it with the
machine's plain ``python``, before any project environment exists, so an import of
anything installed breaks the one entry point that is supposed to work from a cold start.
The project venv is used for the *suite*, as a subprocess, which is a different thing.

Usage: ``python scripts/local-e2e.py`` (add ``-k EXPR`` and it is forwarded to pytest)
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = REPO_ROOT / ".env.local-e2e"
ENV_EXAMPLE = ".env.local-e2e.example"
ARTIFACT = REPO_ROOT / "logs" / "local-e2e.log"
SUITE = "tests/local_e2e"

# Exit code for "not configured". Distinct from 1 (a step failed) because the two want
# different reactions: 2 means go write .env.local-e2e, 1 means go read the artifact.
EXIT_UNCONFIGURED = 2

# The VanillaLand-side entry points, relative to VS_REPO_DIR. Both are owned by that
# repo; this script only knows where to look and what a non-zero exit means.
VS_START_SCRIPT = Path(".local") / "carameli-e2e" / "start.ps1"
VS_DRIVER_SCRIPT = Path("AppCode") / "CarameliE2EDriver" / "run.ps1"

HEALTH_TIMEOUT_S = 120.0
HEALTH_INTERVAL_S = 3.0

OK = "OK"
FAILED = "FAILED"
SKIPPED = "SKIPPED"


# --------------------------------------------------------------------------------------
# environment
# --------------------------------------------------------------------------------------


def parse_dotenv(text: str) -> dict[str, str]:
    """Parse ``KEY=VALUE`` lines the way ``tests/local_e2e/helpers.load_dotenv`` does.

    Deliberately the same tiny grammar rather than a shared import: ``helpers`` lives
    under ``tests/`` and importing it here would make this script depend on the suite it
    is supposed to be able to run without. ``tests/unit/test_local_e2e_script.py`` pins
    the two parsers against each other so the duplication cannot drift.
    """
    values: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if key:
            values[key] = value.strip().strip('"').strip("'")
    return values


def resolve_env(file_values: dict[str, str], environ: dict[str, str]) -> dict[str, str]:
    """Merge the file under the real environment — **the real environment wins**.

    Same precedence as the suite's loader, so a one-off
    ``CARAMELI_BASE_URL=... python scripts/local-e2e.py`` overrides the file rather than
    being silently ignored, and this script and pytest never disagree about the config.
    """
    return {**file_values, **environ}


def gate_reason(env_file: Path, env: dict[str, str]) -> str | None:
    """Why the run cannot start, as one actionable line, or ``None`` when it can.

    Returned rather than printed so the caller decides the exit code, and so the reason
    lands in the artifact as well as on the terminal.
    """
    if not env_file.is_file():
        return (
            f"{env_file.name} not found at the repo root — copy {ENV_EXAMPLE} to "
            f"{env_file.name} and fill it in"
        )
    if env.get("RUN_LOCAL_E2E") != "1":
        return (
            f"RUN_LOCAL_E2E is not 1 — set it in {env_file.name} (see {ENV_EXAMPLE}) to "
            "enable the local integration run"
        )
    return None


# --------------------------------------------------------------------------------------
# command planning
# --------------------------------------------------------------------------------------


def health_url(base_url: str) -> str:
    """``CARAMELI_BASE_URL`` plus ``/health``, tolerant of a trailing slash."""
    return f"{base_url.rstrip('/')}/health"


def powershell_command(script: Path) -> list[str]:
    """The argv for running a ``.ps1``, bypassing whatever execution policy is in force.

    ``-File`` rather than ``-Command`` so the script's own exit code propagates: with
    ``-Command`` PowerShell exits 0 for a script that merely wrote to the error stream,
    which would turn a failed VanillaSoft boot into a green run.
    """
    return ["powershell", "-ExecutionPolicy", "Bypass", "-File", str(script)]


def vs_start_command(vs_repo_dir: str | None) -> tuple[list[str] | None, str]:
    """Plan step 2: bring up the VanillaSoft side. ``(argv, note)``; ``argv`` None to skip.

    ``start.ps1`` is idempotent — it no-ops on every service already running — so this is
    safe to invoke on a stack a parallel agent is using.
    """
    if not vs_repo_dir:
        return None, (
            f"VS_REPO_DIR is not set in {ENV_FILE.name}, so the VanillaSoft side cannot "
            f"be booted (see {ENV_EXAMPLE})"
        )
    script = Path(vs_repo_dir) / VS_START_SCRIPT
    if not script.is_file():
        return None, f"{script} does not exist — VanillaSoft's boot script was not found"
    return powershell_command(script), str(script)


def driver_command(vs_repo_dir: str | None) -> tuple[list[str] | None, str]:
    """Plan step 5: the .NET outbound driver, which may not exist yet.

    ``CarameliE2EDriver`` is being added in the VanillaLand repo. Its absence is a
    **skip that names the path**, never a silent pass — the note is how the reader learns
    the outbound direction went unexercised. Once present, a non-zero exit is a failure
    like any other.
    """
    if not vs_repo_dir:
        return None, f"VS_REPO_DIR is not set, so {VS_DRIVER_SCRIPT} cannot be located"
    script = Path(vs_repo_dir) / VS_DRIVER_SCRIPT
    if not script.is_file():
        return None, (
            f"{script} does not exist yet — the .NET outbound driver is not in this "
            "VanillaLand checkout, so the Carameli -> VanillaSoft direction is untested"
        )
    return powershell_command(script), str(script)


def venv_python(repo_root: Path) -> Path:
    """The project venv's interpreter for this platform."""
    if os.name == "nt":
        return repo_root / ".venv" / "Scripts" / "python.exe"
    return repo_root / ".venv" / "bin" / "python"


def pytest_command(repo_root: Path, extra: list[str] | None = None) -> tuple[list[str], str | None]:
    """Plan step 4: ``(argv, warning)``. The warning is set when the venv is missing.

    Falls back to ``sys.executable`` rather than refusing, because a missing venv is a
    provisioning gap and the suite may well still import — but it is *reported*, since a
    fallback interpreter is the likeliest explanation for an import error that has
    nothing to do with the integration.
    """
    interpreter = venv_python(repo_root)
    warning = None
    if not interpreter.exists():
        warning = (
            f"{interpreter} not found — falling back to {sys.executable}. Create the "
            "project venv if the suite fails on an import."
        )
        interpreter = Path(sys.executable)
    return [str(interpreter), "-m", "pytest", SUITE, "-q", *(extra or [])], warning


# --------------------------------------------------------------------------------------
# results and the artifact
# --------------------------------------------------------------------------------------


@dataclass
class StepResult:
    """One orchestrated step's outcome, in the shape the artifact renders."""

    name: str
    status: str
    detail: str = ""
    exit_code: int | None = None
    output: str = ""
    command: list[str] = field(default_factory=list)

    @property
    def failed(self) -> bool:
        return self.status == FAILED


def render_artifact(results: list[StepResult], *, gate: str | None = None) -> str:
    """Build ``logs/local-e2e.log`` — written on success **and** failure, overwritten.

    Written on success too because the runners here treat a missing artifact as "clean",
    so a stale green file from yesterday's run would be read as today's result. A
    machine-readable summary block leads, so a reader (or an agent) can tell which step
    broke without parsing the captured output that follows.
    """
    lines = [
        "# Local integration run (scripts/local-e2e.py)",
        f"# generated: {time.strftime('%Y-%m-%d %H:%M:%S')}",
        "# Runbook: docs/operations/local-integration-testing.md",
        "",
    ]
    if gate:
        lines += ["## not started", "", gate, ""]
        return "\n".join(lines) + "\n"

    lines += ["## summary", ""]
    for result in results:
        code = "" if result.exit_code is None else f" (exit {result.exit_code})"
        lines.append(f"{result.status:<8} {result.name}{code}")
    lines.append("")

    for result in results:
        if result.status == OK and not result.output:
            continue
        lines += [f"## {result.name} — {result.status}", ""]
        if result.command:
            lines += [f"command: {' '.join(result.command)}", ""]
        if result.detail:
            lines += [result.detail, ""]
        if result.output:
            lines += [result.output.rstrip(), ""]
    return "\n".join(lines) + "\n"


def write_artifact(path: Path, text: str) -> None:
    """Persist the artifact, creating ``logs/`` if this is a fresh checkout.

    UTF-8 explicitly: the suite's assertion messages carry en-dashes and whatever bytes a
    failing endpoint echoed back, and a Windows default of cp1252 would raise here — after
    the run, losing the report that explains it.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def overall_exit_code(results: list[StepResult]) -> int:
    """1 if any step failed, else 0. A SKIPPED step is not a failure."""
    return 1 if any(result.failed for result in results) else 0


# --------------------------------------------------------------------------------------
# execution
# --------------------------------------------------------------------------------------


def run_step(name: str, command: list[str], cwd: Path, env: dict[str, str]) -> StepResult:
    """Run one subprocess, capturing combined output for the artifact."""
    print(f"[{name}] {' '.join(command)}", flush=True)
    try:
        proc = subprocess.run(
            command,
            cwd=str(cwd),
            env={**os.environ, **env, "PYTHONIOENCODING": "utf-8"},
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except OSError as exc:
        return StepResult(name, FAILED, detail=f"could not launch: {exc}", command=command)
    return StepResult(
        name,
        OK if proc.returncode == 0 else FAILED,
        exit_code=proc.returncode,
        output=proc.stdout or "",
        command=command,
    )


def probe_health(url: str, timeout_s: float = 5.0) -> tuple[bool, str]:
    """One GET against ``/health``. ``(healthy, detail)`` — never raises."""
    request = urllib.request.Request(url, headers={"ngrok-skip-browser-warning": "1"})
    try:
        with urllib.request.urlopen(request, timeout=timeout_s) as response:
            body = response.read(2000).decode("utf-8", errors="replace")
            return response.status == 200, f"{response.status} {body[:200]}"
    except urllib.error.HTTPError as exc:
        return False, f"HTTP {exc.code}"
    except OSError as exc:
        return False, str(exc)


def wait_for_health(url: str, *, timeout_s: float = HEALTH_TIMEOUT_S) -> tuple[bool, str]:
    """Poll ``/health`` until it answers 200 or the budget runs out."""
    deadline = time.monotonic() + timeout_s
    detail = "never probed"
    while True:
        healthy, detail = probe_health(url)
        if healthy:
            return True, detail
        if time.monotonic() >= deadline:
            return False, f"still unhealthy after {timeout_s:.0f}s: {detail}"
        time.sleep(HEALTH_INTERVAL_S)


def ensure_carameli_up(base_url: str, env: dict[str, str]) -> StepResult:
    """Step 3: verify Carameli answers, and ``docker compose up -d`` it when it does not.

    The probe comes first and the compose call only on a miss, because this stack is
    routinely shared with another agent's session — starting what is already running is
    at best wasted time and at worst a restart under someone else's test run.
    """
    name = "carameli up"
    url = health_url(base_url)
    healthy, detail = probe_health(url)
    if healthy:
        return StepResult(name, OK, detail=f"{url} already healthy ({detail})")

    boot = run_step("carameli docker compose up", ["docker", "compose", "up", "-d"], REPO_ROOT, env)
    if boot.failed:
        boot.detail = f"{url} was unreachable ({detail}) and `docker compose up -d` failed"
        return boot

    healthy, detail = wait_for_health(url)
    return StepResult(
        name,
        OK if healthy else FAILED,
        detail=f"{url}: {detail}",
        output=boot.output,
    )


def seed_sql() -> str:
    """Idempotent SQL giving the e2e customer one extension and one phone line.

    Two of the suite's field-level contract tests — the ones that check that
    ``GET /api/v1/extensions`` and ``GET /api/v1/phone-lines`` return the fields
    ``CarameliExtensionResponse`` and ``CarameliPhoneLineResponse`` bind — can only assert
    against a row that exists, and skip when the list comes back empty. The obvious way to
    create those rows is the API, and it is the wrong way: ``POST /VsExtension/Add``
    provisions a SIP endpoint on the real call engine and ``POST /PhoneLine/Add`` buys a
    real DID from the carrier, both against the live provider credentials in ``.env``. So
    the rows go in directly, and they are inert by construction — the extension has no
    ``sip_credential_sid`` and the line's ``provider_sid`` names itself, so nothing
    downstream can mistake either for a provisioned object.

    The numbers come from the fictional ``555-0100`` block, which is not routable.
    ``WHERE NOT EXISTS`` rather than ``ON CONFLICT`` because neither column pair carries a
    unique constraint; re-running is a no-op either way.

    The customer id is **not** interpolated: it arrives as psql's ``:vsid``, set by
    :func:`seed_command` on the command line. That keeps this a constant string, which is
    both what makes it reviewable and why it does not need an ``S608`` suppression.
    """
    return """
BEGIN;
WITH c AS (SELECT id FROM customers WHERE vs_customer_id = :vsid)
INSERT INTO extensions (customer_id, extension_number, sip_username, active)
SELECT c.id, '9001', 'local-e2e-9001', true FROM c
WHERE NOT EXISTS (
    SELECT 1 FROM extensions e WHERE e.customer_id = c.id AND e.extension_number = '9001'
);
WITH c AS (SELECT id FROM customers WHERE vs_customer_id = :vsid)
INSERT INTO phone_lines (customer_id, phone_number, provider_sid, active)
SELECT c.id, '+15555550100', 'local-e2e-synthetic', true FROM c
WHERE NOT EXISTS (
    SELECT 1 FROM phone_lines p WHERE p.customer_id = c.id AND p.phone_number = '+15555550100'
);
COMMIT;
"""


def seed_command(vs_customer_id: int, project: str | None = None) -> list[str]:
    """``docker compose exec`` piping the seed into the db service's own ``psql``.

    The credentials are read from the container's environment rather than from any file
    here: ``POSTGRES_USER``/``POSTGRES_DB`` are already set for that service, and copying
    them into this script would be a second place for them to drift.

    ``vs_customer_id`` is typed ``int`` so the only value that can reach the shell is a
    number — the caller does the coercion, and a non-numeric setting fails there with a
    readable error rather than becoming shell text.

    ``project`` exists because *this checkout is not always the one running the stack*. An
    ephemeral worktree gets its own ``COMPOSE_PROJECT_NAME`` so its containers cannot
    collide with the static checkout's, which means a bare ``docker compose exec db`` run
    from a box resolves to the box's own project and reports ``service "db" is not
    running`` — while the ``CARAMELI_BASE_URL`` the suite is testing is served by a
    different project entirely. ``CARAMELI_COMPOSE_PROJECT`` names the one that owns the
    database the suite will read back through.
    """
    project_args = ["-p", project] if project else []
    return [
        "docker",
        "compose",
        *project_args,
        "exec",
        "-T",
        "db",
        "sh",
        "-c",
        'psql -v ON_ERROR_STOP=1 -v vsid=%d -U "$POSTGRES_USER" -d "$POSTGRES_DB"' % vs_customer_id,
    ]


def seed_fixture_rows(vs_customer_id: str | None, env: dict[str, str]) -> StepResult:
    """Step 3b: ensure the two field-contract tests have a row to assert against.

    A missing db container is a **skip that says so**, not a failure: the suite is
    designed to run against a Carameli that may be somewhere else entirely (see
    ``tests/local_e2e/conftest.py``), and in that configuration there is no local database
    to seed. The two tests then skip with their own message, which is the honest outcome.
    """
    name = "seed fixture rows"
    if not vs_customer_id:
        return StepResult(
            name, SKIPPED, detail=f"CARAMELI_VS_CUSTOMER_ID is not set in {ENV_FILE.name}"
        )
    try:
        customer = int(vs_customer_id)
    except ValueError:
        return StepResult(
            name,
            FAILED,
            detail=f"CARAMELI_VS_CUSTOMER_ID is not a number: {vs_customer_id!r}",
        )
    command = seed_command(customer, env.get("CARAMELI_COMPOSE_PROJECT"))
    print(f"[{name}] {' '.join(command)}", flush=True)
    try:
        proc = subprocess.run(
            command,
            cwd=str(REPO_ROOT),
            env={**os.environ, **env, "PYTHONIOENCODING": "utf-8"},
            input=seed_sql(),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except OSError as exc:
        return StepResult(name, SKIPPED, detail=f"could not launch docker compose: {exc}")
    if proc.returncode != 0:
        return StepResult(
            name,
            SKIPPED,
            detail=(
                "the local `db` service did not accept the seed, so the two field-contract "
                "tests will skip. Expected when Carameli is remote. When it is local but "
                "this checkout is an ephemeral box, `docker compose` resolves to the box's "
                f"own project — set CARAMELI_COMPOSE_PROJECT in {ENV_FILE.name} to the "
                "project that is actually serving CARAMELI_BASE_URL"
            ),
            exit_code=proc.returncode,
            output=proc.stdout or "",
            command=command,
        )
    return StepResult(
        name, OK, detail=f"customer {vs_customer_id} has an extension and a phone line"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "pytest_args",
        nargs=argparse.REMAINDER,
        help="extra arguments forwarded to pytest (e.g. -k vsapi)",
    )
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)

    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="replace")

    file_values = parse_dotenv(ENV_FILE.read_text(encoding="utf-8")) if ENV_FILE.is_file() else {}
    env = resolve_env(file_values, dict(os.environ))

    gate = gate_reason(ENV_FILE, env)
    if gate:
        write_artifact(ARTIFACT, render_artifact([], gate=gate))
        print(f"LOCAL E2E not configured: {gate}", file=sys.stderr)
        print(f"Artifact : {ARTIFACT}")
        return EXIT_UNCONFIGURED

    # Only the file's own keys need exporting; the rest are already in os.environ.
    child_env = dict(file_values)
    results: list[StepResult] = []

    # 2. VanillaSoft side.
    command, note = vs_start_command(env.get("VS_REPO_DIR"))
    if command is None:
        results.append(StepResult("vanillasoft up", FAILED, detail=note))
    else:
        results.append(run_step("vanillasoft up", command, REPO_ROOT, child_env))

    # 3. Carameli side.
    results.append(ensure_carameli_up(env.get("CARAMELI_BASE_URL", ""), child_env))

    # 3b. Fixture rows the suite cannot create for itself without calling a real provider.
    results.append(seed_fixture_rows(env.get("CARAMELI_VS_CUSTOMER_ID"), child_env))

    # 4. The suite — run even when a boot step failed, because its assertion messages name
    #    the specific service at fault far better than a boot script's stderr does.
    pytest_argv, warning = pytest_command(REPO_ROOT, [a for a in args.pytest_args if a != "--"])
    if warning:
        print(f"WARNING: {warning}", file=sys.stderr)
    suite = run_step("local_e2e suite", pytest_argv, REPO_ROOT, child_env)
    if warning:
        suite.detail = warning
    results.append(suite)

    # 5. The .NET outbound driver, if this VanillaLand checkout has it yet.
    command, note = driver_command(env.get("VS_REPO_DIR"))
    if command is None:
        results.append(StepResult("outbound driver", SKIPPED, detail=note))
        print(f"SKIP: {note}")
    else:
        results.append(run_step("outbound driver", command, REPO_ROOT, child_env))

    write_artifact(ARTIFACT, render_artifact(results))

    exit_code = overall_exit_code(results)
    print("")
    for result in results:
        print(f"  {result.status:<8} {result.name}")
    print(f"\nArtifact : {ARTIFACT}")
    print("LOCAL E2E PASSED" if exit_code == 0 else "LOCAL E2E FAILED")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
