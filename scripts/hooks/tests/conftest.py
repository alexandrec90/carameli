"""Shared loader for hook scripts whose filenames contain hyphens.

Hook scripts are not importable as normal modules (hyphenated names, and one
lives outside this tree), so tests load them by path. Each script guards its
side effects behind `if __name__ == '__main__'`, so importing only binds the
pure functions.
"""

import importlib.util
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]

# Put scripts/ on the path so modules under it (e.g. `diagnostics`) import the
# same way they do at runtime, where the script's own dir is sys.path[0].
sys.path.insert(0, str(REPO_ROOT / "scripts"))


def load_module(relpath: str):
    """Load a hook script (path relative to repo root) as a module object."""
    path = REPO_ROOT / relpath
    mod_name = path.stem.replace("-", "_")
    spec = importlib.util.spec_from_file_location(mod_name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
