"""Unit coverage for ``lint-all.py``'s ``run()`` bound and its pip-audit invocation.

Regression guard for a lint run that never ended: after a ``requirements-test.in`` edit,
``python scripts/lint-all.py --changed`` ran pip-audit CPU-bound for 18+ minutes with no
output and was killed by hand. pip-audit was looping on a Windows cache path that kept
its ``\\r`` (see ``PIP_AUDIT_CMD``), and ``run()`` had no timeout to stop it.
"""

from __future__ import annotations

import importlib.util
import sys
import time
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "scripts" / "lint-all.py"


def _load_script() -> Any:
    spec = importlib.util.spec_from_file_location("lint_all_run_script", SCRIPT_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    # `lint-all.py` imports its siblings as top-level modules.
    sys.path.insert(0, str(SCRIPT_PATH.parent))
    try:
        spec.loader.exec_module(module)
    finally:
        sys.path.remove(str(SCRIPT_PATH.parent))
    return module


script = _load_script()
PY = f'"{sys.executable}"'


class TestRun:
    def test_returns_merged_output_and_exit_code(self) -> None:
        cmd = f"{PY} -c \"import sys; print('out', flush=True); sys.stderr.write('err\\n'); sys.exit(3)\""
        lines, code = script.run(cmd)
        assert code == 3
        assert lines == ["out", "err"]

    def test_a_clean_command_passes(self) -> None:
        assert script.run(f'{PY} -c "print(1)"') == (["1"], 0)

    def test_a_hung_command_is_killed_with_its_tree_and_reported(self) -> None:
        """`shell=True` makes the tool a grandchild: killing only the shell left it
        holding the pipe, so the run blocked as if there were no timeout at all."""
        cmd = f"{PY} -c \"import time; print('started', flush=True); time.sleep(120)\""
        began = time.monotonic()
        lines, code = script.run(cmd, timeout=3)
        assert time.monotonic() - began < 60
        assert code == 1
        assert lines[0] == "started"
        assert "killed" in lines[-1]
        assert "after 3s" in lines[-1]

    def test_the_timeout_note_is_a_failure_not_a_skip(self) -> None:
        """A skip is reported as a pass, and a linter that never answered did not pass."""
        from failure_class import get_skip_reason

        lines, _ = script.run(f'{PY} -c "import time; time.sleep(120)"', timeout=2)
        assert get_skip_reason(lines) is None


class TestPipAudit:
    def test_names_its_own_cache_dir(self) -> None:
        """Without `--cache-dir`, pip-audit derives pip's cache path with a trailing
        `\\r` on Windows and spins on it forever."""
        assert "--cache-dir" in script.PIP_AUDIT_CMD

    def test_runs_under_its_own_bound(self, monkeypatch) -> None:
        seen: dict[str, Any] = {}

        def fake_run(cmd: str, timeout: float = 0) -> tuple[list[str], int]:
            seen.update(cmd=cmd, timeout=timeout)
            return [], 0

        monkeypatch.setattr(script, "run", fake_run)
        assert script.t_pip_audit(["requirements-test.in"]) == {"pip-audit": ([], 0)}
        assert seen == {"cmd": script.PIP_AUDIT_CMD, "timeout": script.PIP_AUDIT_TIMEOUT}
        assert script.PIP_AUDIT_TIMEOUT < script.TOOL_TIMEOUT

    def test_skips_when_no_requirements_file_changed(self, monkeypatch) -> None:
        monkeypatch.setattr(script, "run", lambda *a, **k: (_ for _ in ()).throw(AssertionError))
        assert script.t_pip_audit(["app/main.py"]) == {"pip-audit": ([], 0)}
