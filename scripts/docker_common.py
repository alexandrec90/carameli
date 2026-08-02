#!/usr/bin/env python3
"""Shared helpers for the Docker stack scripts (docker-*.py).

These scripts are desktop-only (they drive a local Docker Desktop daemon), but
they are written in Python so the same parsing/artifact logic is importable and
unit-tested. The pure functions here -- `service_from_container`,
`parse_status_entries`, `sick_services`, `format_artifact` -- carry no I/O and
are covered by `scripts/hooks/tests/test_docker_common.py`. The thin subprocess
wrappers (`run`, `run_with_timeout`) are the only impure surface.

Artifacts land in `logs/docker/*.log` for local and CI diagnosis.
"""

import os
import re
import subprocess
import time
from datetime import datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DOCKER_LOG_DIR = REPO_ROOT / "logs" / "docker"

# Statuses that mean a container is broken vs still coming up.
# `Exited (0)` is excluded: one-shot init services (minio-init, jambonz-db-init)
# exit 0 on success, which is their healthy end state, not a failure.
UNHEALTHY_RE = re.compile(r"unhealthy|exited(?! \(0\))|dead|Restarting", re.IGNORECASE)
STARTING_RE = re.compile(r"starting|Created|created", re.IGNORECASE)


def _dotenv_value(key: str, env_file: Path) -> str:
    """First value of `key` in a dotenv file ('' if absent). No interpolation."""
    if not env_file.is_file():
        return ""
    for line in env_file.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped.startswith(f"{key}="):
            return stripped.split("=", 1)[1].strip().strip("'\"")
    return ""


def project_name() -> str:
    """Compose project name, matching Compose v2 precedence.

    COMPOSE_PROJECT_NAME from the environment, then from the repo-root .env,
    then the lowercased leaf of the repo root (Compose's default). Parallel
    worktree stacks pin COMPOSE_PROJECT_NAME in their .env (README.md,
    "Parallel Worktrees"); the `docker ps` filters here must match whatever
    name Compose actually used.
    """
    explicit = os.environ.get("COMPOSE_PROJECT_NAME", "") or _dotenv_value(
        "COMPOSE_PROJECT_NAME", REPO_ROOT / ".env"
    )
    return (explicit or REPO_ROOT.name).lower()


def project_filter() -> str:
    """`docker ps --filter` label selector for this project's containers."""
    return f"label=com.docker.compose.project={project_name()}"


def service_filter(service: str) -> str:
    """`docker ps --filter` label selector for a single compose service."""
    return f"label=com.docker.compose.service={service}"


def timestamp() -> str:
    """Human-readable timestamp for artifact headers."""
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def service_from_container(name: str, project: str) -> str:
    """Strip the `<project>-` prefix and `-<n>` replica suffix from a container name.

    `carameli-app-1` -> `app`. Returns the name unchanged if it doesn't match.
    """
    m = re.match(rf"^{re.escape(project)}-(.+)-\d+$", name)
    return m.group(1) if m else name


def parse_status_entries(lines, project: str) -> list[tuple[str, str]]:
    """Parse `{{.Names}}|{{.Status}}` docker ps output into (service, status) pairs."""
    out: list[tuple[str, str]] = []
    for line in lines:
        if "|" not in line:
            continue
        name, _, status = line.partition("|")
        out.append((service_from_container(name.strip(), project), status.strip()))
    return out


def sick_services(entries, extra_re: re.Pattern | None = None) -> list[str]:
    """Return services whose status matches the unhealthy pattern (de-duped, ordered)."""
    pattern = extra_re or UNHEALTHY_RE
    seen: list[str] = []
    for svc, status in entries:
        if pattern.search(status) and svc not in seen:
            seen.append(svc)
    return seen


def format_artifact(header: str, body_lines) -> str:
    """Build an artifact body: a header, the timestamp, a blank line, then content."""
    lines = [header, f"Timestamp: {timestamp()}", ""]
    lines.extend(body_lines)
    return "\n".join(lines) + "\n"


def ensure_docker_log_dir() -> Path:
    """Create logs/docker/ if missing and return it."""
    DOCKER_LOG_DIR.mkdir(parents=True, exist_ok=True)
    return DOCKER_LOG_DIR


def write_artifact(name: str, content: str) -> Path:
    """Write `content` to logs/docker/<name>. Empty string clears the artifact."""
    ensure_docker_log_dir()
    path = DOCKER_LOG_DIR / name
    path.write_text(content, encoding="utf-8")
    return path


def clear_artifact(name: str) -> Path:
    """Clear an artifact (write empty string) so stale errors don't mislead skills."""
    return write_artifact(name, "")


def run_with_timeout(argv, timeout: int) -> tuple[list[str], int, bool]:
    """Run a docker command with a timeout. Returns (output_lines, exit_code, timed_out).

    docker commands can hang when the daemon is wedged; the timeout guarantees the
    caller regains control. On timeout returns ([], 1, True).
    """
    try:
        p = subprocess.run(
            argv,
            cwd=REPO_ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return [], 1, True
    except OSError as exc:
        return [str(exc)], 1, False
    return (p.stdout or "").splitlines(), p.returncode, False


def run(argv) -> tuple[list[str], int]:
    """Run a command from the repo root, merging stdout+stderr. (lines, exit_code)."""
    lines, code, _ = run_with_timeout(argv, timeout=600)
    return lines, code


def docker_ps(
    fmt: str, *, all_containers: bool = True, extra_filters=None, timeout: int = 15
) -> tuple[list[str], int, bool]:
    """`docker ps [-a] --filter <project> [--filter ...] --format <fmt>`."""
    argv = ["docker", "ps"]
    if all_containers:
        argv.append("-a")
    argv += ["--filter", project_filter()]
    for f in extra_filters or []:
        argv += ["--filter", f]
    argv += ["--format", fmt]
    return run_with_timeout(argv, timeout=timeout)


def docker_logs(container: str, tail: int = 40, timeout: int = 10) -> list[str]:
    """`docker logs <container> --tail <n>`; returns a one-line note on timeout."""
    lines, _, timed_out = run_with_timeout(
        ["docker", "logs", container, "--tail", str(tail)], timeout=timeout
    )
    if timed_out:
        return [
            f"[TIMEOUT] docker logs {container} --tail {tail} timed out after {timeout}s "
            "(container log stream may be stuck)"
        ]
    return lines


def poll_until(probe, timeout: int, interval: int) -> bool:
    """Call `probe()` every `interval`s up to `timeout`s. True if it returns truthy."""
    elapsed = 0
    while elapsed < timeout:
        time.sleep(interval)
        elapsed += interval
        if probe():
            return True
    return False


def banner(title: str) -> str:
    """A bordered status banner block (matches the PowerShell scripts' output)."""
    bar = "  =========================================="
    return f"\n{bar}\n           {title}\n{bar}\n"
