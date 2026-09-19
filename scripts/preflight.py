#!/usr/bin/env python3
"""Whether a gate can run in this checkout at all, and what to say when it cannot.

A linked worktree checks out tracked files only, so a fresh one has no `.venv` and no
`node_modules`. Run `scripts/lint-all.py` there and every tool fails on its own absent
binary; `diagnostics.get_skip_reason` turns most of those into `[skip] ... (not
installed)` and the one that does not becomes a lint *failure* with a tool's name on it.
Both readings are wrong in the same way -- they describe a tool, when the fact is an
unprovisioned checkout -- and the cost is an agent that diagnoses the toolchain instead
of doing the work, installs whatever the red line named, and leaves the rest.

So the runners ask here first, and stop with one actionable line. Stopping, rather than
running what happens to be installed: a lint that skips what it could not run and then
prints PASSED is the "green having checked nothing" failure `.claude/rules/engineering.md`
exists to prevent, and it is the same hole a deleted `logs/` artifact opens.

**Reports, never installs**, like the vendored `scripts/hooks/toolchain.py` it borrows
its fix text from -- a cold install is minutes, and a lint run is not where anyone
expects to spend them. The command is printed for whoever is in a position to spend it.

**Detection is `shutil.which`, not a `.venv` probe.** The question is whether the tools
can be invoked, and that has three yeses: this project's `.venv` (which
`ensure_venv_on_path` puts on `PATH` below), some other activated venv, and CI, which
installs `--system` into the runner's Python and has no `.venv` at all. A directory probe
answers only the first and would fail every CI lint run. `toolchain.missing_toolchain`
probes the directory because its callers report on a checkout rather than on a run.

Pure functions; the only I/O is `report`, which is the runners' shared exit path.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

import diagnostics
import script_common

sys.path.insert(0, str(Path(__file__).resolve().parent / "hooks"))
import harness_config
import toolchain

REPO_ROOT = Path(__file__).resolve().parents[1]

# The host executables a lint run needs, all of them installed by `requirements-dev.in`.
#
# Deliberately absent: `dotenv-linter` and `actionlint`, which are out-of-band binary
# installs (CI curls them; a desktop may not have them) and whose runners already handle
# their own absence. Naming them here would block every machine that never installed
# them, which is a different argument from this one and not one to settle by side effect.
HOST_TOOLS = ("ruff", "mypy", "vulture", "pip-audit", "detect-secrets", "yamllint")


def ensure_venv_on_path(root: Path = REPO_ROOT, env: dict[str, str] | None = None) -> None:
    """Prepend the local venv's bin dir so subprocesses resolve ruff/mypy/etc.

    A no-op when a venv is already active: that one is the caller's explicit choice, and
    prepending a second is how a run ends up using two.
    """
    environ = os.environ if env is None else env
    if environ.get("VIRTUAL_ENV"):
        return
    for sub in ("Scripts", "bin"):
        cand = root / ".venv" / sub
        if cand.exists():
            environ["PATH"] = str(cand) + os.pathsep + environ.get("PATH", "")
            return


def missing_host_tools(names: tuple[str, ...] = HOST_TOOLS, which=shutil.which) -> list[str]:
    """Which of `names` cannot be invoked here, in the order given. Pure."""
    return [name for name in names if not which(name)]


def missing_frontend(root: Path = REPO_ROOT, cfg: harness_config.Config | None = None) -> str:
    """The frontend dir whose `node_modules` is absent, or "" when there is nothing to say.

    Empty for a project with the frontend tier switched off and for a checkout that has
    no frontend directory at all -- the app image is one, and a container run must not be
    told to install a tree it does not carry.
    """
    config = harness_config.load(root) if cfg is None else cfg
    frontend = config.frontend
    if not frontend.enabled or not (root / frontend.dir).is_dir():
        return ""
    if (root / frontend.dir / "node_modules").is_dir():
        return ""
    return frontend.dir


NODE_PIN_FILE = ".nvmrc"


def pinned_node(root: Path = REPO_ROOT) -> str:
    """The Node line this repo pins, or "" when it pins none. Never a literal here.

    The pin is whatever `.nvmrc` says; this module must not know the number, or moving
    the pin would mean editing the thing that checks it.
    """
    path = root / NODE_PIN_FILE
    return path.read_text(encoding="utf-8").strip() if path.exists() else ""


def node_major(version: str) -> str:
    """`v24.8.1`, `24.8.1` and `24` all reduce to `24`; anything else to "". Pure.

    Only the major is compared. `.nvmrc` names a release line and `actions/setup-node`
    resolves it to that line's newest patch, so requiring an exact match would report a
    mismatch on every machine that is merely a fortnight behind on patches.
    """
    match = re.match(r"v?(\d+)", version.strip())
    return match.group(1) if match else ""


def running_node(which=shutil.which, run=subprocess.run) -> str:
    """What `node --version` prints here, or "" when it prints no version.

    Stdout only, deliberately. nvm-windows' shim answers on **stderr** when the line
    `.nvmrc` selects is not installed, and that text says "is not installed or cannot
    be found" -- every phrase `failure_class._MISSING_TOOL` matches. Passing it through
    to a gap line would let the digest reclassify the run's one loud finding as a quiet
    skip, so it is never carried out of this function. `node_gap` says what happened in
    its own words instead, and `present` is what tells the two silences apart.
    """
    if not which("node"):
        return ""
    try:
        done = run(["node", "--version"], capture_output=True, text=True, timeout=30, check=False)
    except OSError:
        return ""
    return (done.stdout or "").strip()


def node_gap(pinned: str, running: str, present: bool) -> str:
    """The one line to say about the Node on PATH, or "" when there is nothing. Pure.

    The fix travels inside the line rather than in the shared `fix:` of `report`, which
    names the Python provisioning command -- a Node mismatch is not fixed by that, and
    printing it here is how an agent ends up rebuilding the venv over a Node problem.

    Same wording constraint as `gaps` below: no phrase `failure_class._MISSING_TOOL`
    matches, or a runner passing this through the digest turns the refusal into a skip.
    """
    if not pinned:
        return ""
    fix = f"run: nvm install {pinned} && nvm use {pinned}"
    if not present:
        return (
            f"node is not on PATH here, and the frontend gates need Node "
            f"{node_major(pinned)} (.nvmrc) -- {fix}"
        )
    if not node_major(running):
        # nvm-windows reads `.nvmrc` itself and refuses when that line is absent, so a
        # node that answers nothing is the ordinary shape of "the pin moved and nobody
        # installed it" -- not an exotic breakage worth a different instruction.
        return (
            f"node on PATH here answers no version, which is what nvm does when the "
            f"line .nvmrc selects ({pinned}) is absent -- {fix}"
        )
    if node_major(running) != node_major(pinned):
        return (
            f"node on PATH is {running} but .nvmrc pins {pinned} -- the frontend gates "
            f"would run against the wrong runtime; {fix}"
        )
    return ""


def node_mismatch(
    root: Path = REPO_ROOT,
    cfg: harness_config.Config | None = None,
    which=shutil.which,
    run=subprocess.run,
) -> str:
    """`node_gap` for this checkout, or "" when Node is not this checkout's business.

    Gated on the same two conditions as `missing_frontend`: a project with the frontend
    tier off has no Node gates to run, and the app image carries no `frontend/` (the
    `.dockerignore` drops it), so a container run must not be told to install a runtime
    it has no use for.
    """
    config = harness_config.load(root) if cfg is None else cfg
    if not config.frontend.enabled or not (root / config.frontend.dir).is_dir():
        return ""
    return node_gap(
        pinned_node(root), running_node(which=which, run=run), present=bool(which("node"))
    )


def provisioning_command(root: Path = REPO_ROOT, cfg: harness_config.Config | None = None) -> str:
    """The one command that provisions this checkout.

    `.devkit.toml`'s `[python] install_command` is the single place it is written, so the
    SessionStart report, `ship.py --preflight` and the runners below cannot name three
    different commands. Falls back to the vendored ladder's derived command for a project
    that does not set one.
    """
    config = harness_config.load(root) if cfg is None else cfg
    return toolchain.python_fix(root, config.python.install_command, config.python.version)


def gaps(
    root: Path = REPO_ROOT,
    cfg: harness_config.Config | None = None,
    which=shutil.which,
    run=subprocess.run,
) -> list[str]:
    """One line per reason the gates cannot run here. Empty when the checkout is ready."""
    config = harness_config.load(root) if cfg is None else cfg
    found: list[str] = []
    absent = missing_host_tools(which=which)
    if absent:
        # Wording note, same as `lint-all.py`'s `_GIT_UNAVAILABLE_LINE`: this text must
        # avoid every phrase `failure_class._MISSING_TOOL` matches ("not installed",
        # "command not found", "Cannot find", ...), so that a runner which later passes
        # it through the digest cannot reclassify the one loud finding as a quiet skip.
        found.append("the Python lint toolchain is not on PATH here: " + ", ".join(absent))
    frontend = missing_frontend(root, config)
    if frontend:
        found.append(
            f"{frontend}/node_modules is absent -- eslint, tsc, stylelint and "
            "markdownlint cannot run"
        )
    # After the node_modules line and not instead of it: a fresh worktree on the wrong
    # Node has both, and installing the tree on the wrong runtime is the trip nobody
    # wants to take twice.
    node = node_mismatch(root, config, which=which, run=run)
    if node:
        found.append(node)
    return found


def artifact_text(label: str, found: list[str], fix: str) -> str:
    """The failure artifact, in `diagnostics`' section format so agents parse it as usual."""
    lines = [diagnostics.source_header(label), "", "# toolchain"]
    if fix:
        lines.append(f"# fix: {fix}")
    lines.extend(found)
    return "\n".join([*lines, ""])


def report(noun: str, artifact_path: Path, label: str, found: list[str], fix: str) -> int:
    """Print the gaps, write the artifact, return 1. The runners' shared refusal.

    A refusal, not a skip: the checkout cannot be checked, and the only honest exit code
    for that is the failing one.
    """
    print(f"\n{noun} cannot run: this checkout is not provisioned.")
    return script_common.emit_report(
        noun=noun,
        artifact_path=artifact_path,
        statuses=[(script_common.FAIL, line) for line in found]
        + ([(script_common.FAIL, f"fix: {fix}")] if fix else []),
        artifact_text=artifact_text(label, found, fix),
        failed=True,
    )
