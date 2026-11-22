#!/usr/bin/env python3
"""Run an npm command in `frontend/` on the Node `.nvmrc` pins: `python scripts/npm.py run gen:phone-metadata`.

`bootstrap.py` caches the pinned Node, but only `lint-all.py` and `run-tests.py` put it
on PATH (`node_runtime.activate`). An npm script an instruction names, typed straight
into a shell, ran PATH's `node` instead: on a Node-18 workstation `npm run
gen:phone-metadata` died with "The requested module 'node:util' does not provide an
export named 'styleText'". This is that activation in front of any npm command, so a
documented `npm run <script>` has one spelling that works on every machine.

Exits npm's own code, or 2 when the pinned Node is neither on PATH nor cached, naming
the command that caches it. Stdlib only: it runs before anything is installed.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

import node_runtime

REPO_ROOT = Path(__file__).resolve().parents[1]
FRONTEND = "frontend"


def unpinned(root: Path, env: dict[str, str]) -> str:
    """Why `env`'s PATH cannot run the pinned Node, or "" when it can. Pure but for
    asking which `node` PATH resolves."""
    major = node_runtime.pinned_major(root)
    if not major or node_runtime.path_node_major(env.get("PATH")) == major:
        return ""
    return (
        f"npm: .nvmrc pins Node {major} and it is neither on PATH nor cached -- "
        "run `python scripts/bootstrap.py` first"
    )


def npm_argv(args: list[str], env: dict[str, str], which=None) -> list[str]:
    """`npm <args>`, the launcher resolved on `env`'s PATH: on Windows `npm` is a `.cmd`
    shim a no-shell `subprocess.run` cannot find by its bare name."""
    resolved = (which or shutil.which)("npm", path=env.get("PATH"))
    return [resolved or "npm", *args]


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if not args or args[0] in ("-h", "--help"):
        print(__doc__.split("\n\n")[0])
        return 0 if args else 2
    env = dict(os.environ)
    node_runtime.activate(REPO_ROOT, env)
    problem = unpinned(REPO_ROOT, env)
    if problem:
        print(problem, file=sys.stderr)
        return 2
    return subprocess.run(npm_argv(args, env), cwd=REPO_ROOT / FRONTEND, env=env).returncode


if __name__ == "__main__":
    raise SystemExit(main())
