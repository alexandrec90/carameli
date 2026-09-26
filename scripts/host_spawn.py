#!/usr/bin/env python3
"""Spawn a command on this host: which executable, and what a failure to start means.

Cut out of `run-tests.py`, which was past its `.devkit-structure.txt` ceiling on
`file_lines` and `definitions` with a raise already recorded against it on the
previous branch. The seam is the one that file's call sites already showed: every
target there is a list of arguments and a place to send the output, while resolving
`argv[0]` for *this* machine -- the venv interpreter, the Windows `.cmd` shim, the
interpreter that turned out not to have pytest -- is a separate concern with no
other reader.

Stdlib plus `script_common`, and the manifest is read lazily, so this imports in a
checkout with nothing provisioned.
"""

from __future__ import annotations

import os
import re
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

import node_runtime
import script_common

REPO_ROOT = Path(__file__).resolve().parents[1]


def python_fix_hint(root: Path = REPO_ROOT) -> str:
    """The provisioning command for a checkout whose interpreter has no test tooling.

    `toolchain.python_fix` is the one definition of that ladder -- the same string
    `session-start.sh` reports and `ship.py --preflight` prints -- so the remedy
    printed into the test artifact cannot drift from the one the session was already
    given.

    Imported inside the function, and "" when it cannot be: the vendored hooks are
    under `scripts/hooks/`, which nothing puts on `sys.path` until a caller does, and
    a runner that will not import is a worse outcome than one with no remedy to
    offer.
    """
    hooks = str(root / "scripts" / "hooks")
    if hooks not in sys.path:
        sys.path.insert(0, hooks)
    try:
        import harness_config
        import toolchain
    except ImportError:
        return ""
    cfg = harness_config.load(root)
    return toolchain.python_fix(root, cfg.python.install_command, cfg.python.version)


_WINDOWS_BATCH_LAUNCHERS = {"npm", "npx", "vite"}
# What must run on `.nvmrc`'s Node rather than whatever PATH offers.
_NODE_LAUNCHERS = _WINDOWS_BATCH_LAUNCHERS | {"node"}


def python_exe(root: Path = REPO_ROOT) -> str:
    """The interpreter a host-side `python -m ...` step must actually spawn.

    `.venv`'s when this checkout has one, else the interpreter already running this
    script -- never the bare name. A bare `python` is resolved by PATH, and on a
    provisioned worktree PATH's first Python is whatever the launcher, the shell
    profile or `uv` left there rather than the one holding this project's
    dependencies: the hook-tests target came back `No module named pytest` twice on
    the same worktree, off two different non-venv interpreters, and
    `logs/test-failures.log` reported it as `[FAIL] hook-tests` -- a missing
    interpreter presented as a failing test tier.

    `sys.executable` is the CI answer and is deliberately the fallback rather than
    the first choice: `.github/actions/setup-python-env` installs the locks
    `--system`, so there is no `.venv` on the runner and the interpreter running
    this script is the one that has pytest. Locally the reverse holds -- the runner
    is launched by whatever Python a task or an agent had to hand, so its
    `sys.executable` is exactly the wrong guess and `.venv` decides.

    In-container argvs are untouched: only `argv[0]` is rewritten, and theirs is
    `docker`.
    """
    venv = script_common.venv_exe("python", root)
    return str(venv) if venv.exists() else sys.executable


def resolve_argv(argv: list[str], root: Path = REPO_ROOT) -> list[str]:
    """Rewrite argv[0] to a concrete executable, leaving the arguments alone.

    Two rewrites: a bare `python` becomes a real interpreter path (`python_exe`),
    and a Windows batch launcher becomes its `.cmd` shim.
    """
    if not argv:
        return argv

    exe = argv[0]
    if exe == "python":
        return [python_exe(root), *argv[1:]]

    if os.name != "nt":
        return argv

    if exe.lower() not in _WINDOWS_BATCH_LAUNCHERS:
        return argv

    resolved = shutil.which(f"{exe}.cmd")
    if not resolved:
        return argv

    return [resolved, *argv[1:]]


_NO_MODULE = re.compile(r"No module named ([^\s'\"]+)")


def interpreter_gap_lines(argv: list[str], lines: list[str], fix: str = "") -> list[str]:
    """Explain a `python -m <module>` run that died for want of `<module>`. Pure.

    Empty for everything else, so the caller appends unconditionally.

    runpy's whole message is `<interpreter>: No module named pytest`, which names the
    module and not the interpreter -- and `digest_tests` then wrote it under the
    target's own heading, so the artifact said `[FAIL] hook-tests` for a tier that had
    never run a test. These lines say which of the two it was.

    The unquoted spelling is the discriminator, and is why the pattern excludes
    quotes: `ModuleNotFoundError: No module named 'httpx'` is a test importing
    something the project dropped -- a real failure, and explaining it away as an
    environment problem is the opposite of a help.

    Deliberately NOT routed through `failure_class.get_skip_reason`: a skip leaves
    `any_failed` False, so classifying a missing interpreter as environmental would
    report green having run nothing -- the hole `_BROKEN_RUNTIME` exists to keep shut.
    The run stays red; only the explanation is added.
    """
    if len(argv) < 2 or argv[1] != "-m":
        return []
    match = _NO_MODULE.search("\n".join(lines))
    if not match:
        return []
    out = [
        "",
        f"[env] this interpreter has no `{match.group(1)}`, so the target never ran:",
        f"  {argv[0]}",
        "  The failure above is the interpreter, not a test.",
    ]
    if fix:
        out.append(f"  fix: {fix}")
    return out


def run_argv(argv: list[str], extra_env: dict[str, str] | None = None) -> tuple[list[str], int]:
    """Run a command from the repo root, merging stdout+stderr in order.

    Argv form (no shell) so multi-line bash passed to `docker compose exec`
    survives without cross-platform quoting hazards.
    """
    if argv and argv[0] in _NODE_LAUNCHERS:
        # Process-wide, not on the copy below: on Windows `resolve_argv` finds the
        # `.cmd` shim through this process's PATH, and a shim beside the machine's own
        # Node would run that Node whatever the child's PATH said.
        node_runtime.activate(REPO_ROOT)
    env = os.environ.copy()
    if extra_env:
        env.update(extra_env)
    argv = resolve_argv(argv)
    p = subprocess.run(
        argv,
        cwd=REPO_ROOT,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    lines = (p.stdout or "").splitlines()
    return lines + interpreter_gap_lines(argv, lines, python_fix_hint()), p.returncode


def host_argv(bash_cmd: str) -> list[str]:
    """The in-container `pytest ...` command as host argv.

    `python_exe() -m pytest`, not a bare `pytest`: the box's venv is not on PATH
    (provisioning does not activate it), so the bare name finds some other
    interpreter's pytest or none at all. It went through `sys.executable` first,
    which is right on CI and a guess locally -- the runner is launched by whatever
    Python the task or the agent had to hand. `python_exe` prefers `.venv` and keeps
    `sys.executable` as the fallback, so both ends hold.

    Impure only in the `pytest` branch, and only in reading whether `.venv` exists.
    """
    parts = shlex.split(bash_cmd)
    if parts and parts[0] == "pytest":
        return [python_exe(), "-m", "pytest", *parts[1:]]
    return parts
