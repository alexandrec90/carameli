#!/usr/bin/env python3
"""Windows-specific Docker Desktop recovery helpers.

Shared by `docker-restart-engine.py` and `docker-fix.py`. These shell out to
native Windows tools (taskkill, sc, wsl, Start-Process, Optimize-VHD) rather
than maintaining a separate `.ps1`. Everything here is impure (process / service
control); the small pure helpers (`vhdx_path`, `filter_taskkill_noise`) are
unit-tested in `scripts/hooks/tests/test_docker_win.py`.
"""

import ctypes
import os
import re
import subprocess
from pathlib import Path

import docker_common as dc

DOCKER_DESKTOP_EXE = r"C:\Program Files\Docker\Docker\Docker Desktop.exe"
DOCKER_STATE_DIRS = [r"%APPDATA%\Docker", r"%LOCALAPPDATA%\Docker"]

# Docker Desktop processes to kill for a clean engine stop. Shared by
# docker-restart-engine.py (recovery) and docker-prune.py (stop before
# compaction) so the two never drift -- an incomplete stop is what lets
# Docker Desktop remount the VHDX mid-compaction and wedge the engine.
ENGINE_PROCESSES = ["Docker Desktop", "com.docker.backend", "com.docker.service"]


def is_admin() -> bool:
    """True if the current process is elevated (Windows)."""
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except (AttributeError, OSError):
        return False


def filter_taskkill_noise(lines):
    """Drop 'not found' lines (expected when a process is already gone)."""
    return [ln for ln in lines if "not found" not in ln.lower()]


def kill_process(image: str) -> list[str]:
    """`taskkill /f /im <image>.exe`; returns filtered output lines."""
    p = subprocess.run(
        ["taskkill", "/f", "/im", f"{image}.exe"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return filter_taskkill_noise((p.stdout or "").splitlines())


def stop_processes(images) -> None:
    for image in images:
        for line in kill_process(image):
            print(f"  {line}")


def process_running(image: str) -> bool:
    """True if a process with the given image name (without .exe) is running."""
    p = subprocess.run(
        ["tasklist", "/fi", f"imagename eq {image}.exe", "/nh"],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return f"{image}.exe".lower() in (p.stdout or "").lower()


def stop_service(name: str) -> None:
    subprocess.run(["sc", "stop", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def start_service(name: str) -> None:
    subprocess.run(["sc", "start", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def wsl_shutdown(timeout: int = 15) -> tuple[bool, list[str]]:
    """Run `wsl --shutdown` with a timeout. Returns (ok, output_lines)."""
    try:
        p = subprocess.run(
            ["wsl", "--shutdown"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        return False, []
    except OSError as exc:
        return False, [str(exc)]
    return p.returncode == 0, (p.stdout or "").splitlines()


def launch_docker_desktop(exe: str = DOCKER_DESKTOP_EXE) -> bool:
    """Start Docker Desktop. Returns False if the executable is missing."""
    if not Path(exe).exists():
        return False
    subprocess.Popen([exe], close_fds=True)
    return True


def docker_info_ok(timeout: int = 10) -> bool:
    """True if `docker info` returns success within the timeout (engine is up)."""
    try:
        p = subprocess.run(
            ["docker", "info"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=timeout,
        )
    except (subprocess.TimeoutExpired, OSError):
        return False
    return p.returncode == 0


def vhdx_path() -> Path:
    """Path to the Docker WSL data VHDX under LOCALAPPDATA."""
    local = os.environ.get("LOCALAPPDATA", "")
    return Path(local) / "Docker" / "wsl" / "disk" / "docker_data.vhdx"


def optimize_vhd(path: Path) -> tuple[int, list[str]]:
    """Compact the VHDX via the Optimize-VHD cmdlet. Returns (exit_code, output)."""
    p = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            f"Optimize-VHD -Path '{path}' -Mode Full",
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return p.returncode, (p.stdout or "").splitlines()


def restart_engine(poll_timeout: int = 90, poll_interval: int = 5, log=print) -> bool:
    """Full Docker Desktop recovery: kill -> wsl shutdown -> (service) -> relaunch -> poll.

    Returns True once `docker info` succeeds within `poll_timeout`, else False.
    Elevation is required for the service stop/start; without it this degrades to
    a process-kill + relaunch, which clears most "Starting the Docker Engine"
    hangs. Shared by docker-restart-engine.py (the recovery task) and
    docker-prune.py (auto-recovery when the post-compaction relaunch stalls) so
    the two can never drift.
    """
    admin = is_admin()
    log("Stopping Docker Desktop...")
    stop_processes(ENGINE_PROCESSES)
    if admin:
        stop_service("com.docker.service")
    else:
        log("  [WARN] Not Admin -- skipping service stop (process kill only)")
    log("Shutting down WSL...")
    wsl_shutdown()
    if admin:
        start_service("com.docker.service")
    if not launch_docker_desktop():
        log(f"  [ERROR] Docker Desktop not found at {DOCKER_DESKTOP_EXE}")
        return False
    log(f"Waiting for Docker engine (timeout {poll_timeout}s)...")
    return dc.poll_until(docker_info_ok, timeout=poll_timeout, interval=poll_interval)


def expand_state_dirs(dirs=None) -> list[Path]:
    """Expand %APPDATA%/%LOCALAPPDATA% in the Docker cache dir list."""

    def _expand(s: str) -> str:
        return re.sub(r"%([^%]+)%", lambda m: os.environ.get(m.group(1), m.group(0)), s)

    return [Path(_expand(d)) for d in (dirs or DOCKER_STATE_DIRS)]
