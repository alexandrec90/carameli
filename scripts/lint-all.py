#!/usr/bin/env python3
"""Runs all linters (in parallel), then writes actionable failures to
`logs/lint-errors.log` for AI-agent consumption. On pass, clears the artifact.

One entrypoint for every environment:
  - **Local desktop / mobile-less sessions:** `python scripts/lint-all.py`
    Runs host tools from the venv; `alembic check` runs inside the app container.
  - **CI (GitHub Actions):** `python scripts/lint-all.py` with `CI=true` set.
    Runs the same host tools directly (no Docker stack); `alembic check` runs
    against the service Postgres. Auto-fixes land in the working tree for the
    workflow to commit.

Filtering / artifact format live in `scripts/diagnostics.py` (the single source
of truth shared with `scripts/run-tests.py`), so local and CI never drift.
"""

import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import diagnostics

REPO_ROOT = Path(__file__).resolve().parents[1]
IS_CI = bool(os.environ.get("CI"))


def _ensure_venv_on_path() -> None:
    """Prepend the local venv's bin dir so subprocesses resolve ruff/mypy/etc."""
    if os.environ.get("VIRTUAL_ENV"):
        return
    for sub in ("Scripts", "bin"):
        cand = REPO_ROOT / ".venv" / sub
        if cand.exists():
            os.environ["PATH"] = str(cand) + os.pathsep + os.environ.get("PATH", "")
            return


def run(cmd: str) -> tuple[list[str], int]:
    """Run a shell command from the repo root, merging stdout+stderr in order."""
    # shell=True is intentional: cmd is a trusted first-party tool invocation
    # (ruff/mypy/eslint/...), not external input.
    p = subprocess.run(  # noqa: S602
        cmd,
        shell=True,
        cwd=REPO_ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    return (p.stdout or "").splitlines(), p.returncode


# ---------------------------------------------------------------------------
# Per-tool runners. Each returns {report_name: (lines, exit_code)}. Tools that
# auto-fix do so before the reporting pass so only unfixable issues are reported.
# ---------------------------------------------------------------------------


def t_ruff() -> dict:
    # Fix then format sequentially (format after fix) before the reporting pass.
    run("ruff check . --fix --unsafe-fixes --quiet")
    run("ruff format . --quiet")
    return {
        "ruff-check": run("ruff check . --output-format=full"),
        "ruff-format": run("ruff format --check ."),
    }


def t_eslint() -> dict:
    return {"eslint": run("npm --prefix frontend run lint:eslint -- --fix")}


def t_tsc() -> dict:
    return {"tsc": run("npm --prefix frontend run lint:types")}


def t_stylelint() -> dict:
    return {"stylelint": run("npm --prefix frontend run lint:css -- --fix")}


def t_markdownlint() -> dict:
    return {
        "markdownlint": run(
            'npm --prefix frontend exec --yes -- markdownlint "**/*.md" '
            '--ignore "**/node_modules/**" --ignore "**/.git/**" --ignore "**/.venv/**" '
            '-c ".markdownlint.json" --fix'
        )
    }


def t_mypy() -> dict:
    return {"mypy": run("mypy app/")}


def t_vulture() -> dict:
    return {"vulture": run('vulture app/ --min-confidence 80 --ignore-names "cls,ctx,opts"')}


def t_pip_audit() -> dict:
    ignore = "--ignore-vuln CVE-2026-4539"
    # Keep pip itself current so it never appears in audit results.
    run("python -m pip install --upgrade pip --quiet")
    first, code = run(f"pip-audit {ignore}")
    if code != 0:
        pkgs: list[str] = []
        for line in first:
            m = re.match(r"^(\S+)\s+[\d.]+\s+\S+\s+[\d.]+\s*$", line)
            if m and m.group(1) not in pkgs:
                pkgs.append(m.group(1))
        for pkg in pkgs:
            run(f"python -m pip install --upgrade {pkg} --quiet")
    return {"pip-audit": run(f"pip-audit {ignore}")}


def t_alembic_check() -> dict:
    # Locally the DB lives in the app container; in CI it's the service Postgres
    # the runner can reach directly.
    cmd = "alembic check" if IS_CI else "docker compose exec -T app alembic check"
    return {"alembic-check": run(cmd)}


def t_yamllint() -> dict:
    targets = [
        t
        for t in (
            ".pre-commit-config.yaml",
            ".github/workflows",
            "docker-compose.yml",
            "prometheus.yml",
        )
        if (REPO_ROOT / t).exists()
    ]
    if not targets:
        return {"yamllint": ([], 0)}
    return {"yamllint": run("yamllint --strict -f parsable " + " ".join(targets))}


def t_actionlint() -> dict:
    wf = REPO_ROOT / ".github" / "workflows"
    if not wf.exists() or not list(wf.glob("*.yml")):
        return {"actionlint": ([], 0)}
    return {"actionlint": run("actionlint")}


def t_lint_instructions() -> dict:
    return {"lint-instructions": run("python scripts/lint-instructions.py")}


def t_dotenv() -> dict:
    envs = [p.name for p in sorted(REPO_ROOT.glob(".env*")) if p.is_file()]
    if not envs:
        return {"dotenv-linter": ([], 0)}
    return {"dotenv-linter": run("dotenv-linter check " + " ".join(envs))}


def t_detect_secrets() -> dict:
    """Scan for secrets; auto-acknowledge new findings into the baseline.

    detect-secrets never blocks the suite (it exits 0 after updating the
    baseline) -- real secrets surface in `git diff .secrets.baseline` for review.
    """
    import json

    exclude = '--exclude-files "\\.secrets\\.baseline"'
    baseline = REPO_ROOT / ".secrets.baseline"

    if not baseline.exists():
        out, _ = run(f"detect-secrets scan {exclude}")
        baseline.write_text("\n".join(out), encoding="utf-8")
        return {"detect-secrets": ([], 0)}

    scan_lines, code = run(f"detect-secrets scan {exclude}")
    scan_raw = "\n".join(scan_lines)
    if code != 0:
        return {"detect-secrets": ([f"detect-secrets: scan error: {scan_raw}"], 1)}
    try:
        new_scan = json.loads(scan_raw)
    except ValueError:
        return {"detect-secrets": (["detect-secrets: could not parse scan output"], 1)}
    try:
        existing = json.loads(baseline.read_text(encoding="utf-8"))
    except ValueError:
        out, _ = run(f"detect-secrets scan {exclude}")
        baseline.write_text("\n".join(out), encoding="utf-8")
        return {"detect-secrets": ([], 0)}

    new_items: list[str] = []
    for file, secrets in (new_scan.get("results") or {}).items():
        base_hashes = {
            s.get("hashed_secret") for s in (existing.get("results") or {}).get(file, [])
        }
        for secret in secrets:
            if secret.get("hashed_secret") not in base_hashes:
                new_items.append(f"{file}:{secret.get('line_number')}: {secret.get('type')}")
    if new_items:
        run(f'detect-secrets scan --update ".secrets.baseline" {exclude}')
        print(
            f"  [auto-fix] detect-secrets: {len(new_items)} new finding(s) added to "
            ".secrets.baseline -- review with: git diff .secrets.baseline"
        )
    return {"detect-secrets": ([], 0)}


# CI runs the same host tools as the desktop lint task, minus the ones that
# either mutate a committed baseline (detect-secrets) or are enforced elsewhere
# (dotenv-linter / lint-instructions run via pre-commit locally).
LOCAL_TOOLS = [
    t_ruff,
    t_eslint,
    t_tsc,
    t_stylelint,
    t_markdownlint,
    t_mypy,
    t_pip_audit,
    t_vulture,
    t_detect_secrets,
    t_alembic_check,
    t_dotenv,
    t_yamllint,
    t_actionlint,
    t_lint_instructions,
]
CI_TOOLS = [
    t_ruff,
    t_eslint,
    t_tsc,
    t_stylelint,
    t_markdownlint,
    t_mypy,
    t_pip_audit,
    t_vulture,
    t_alembic_check,
    t_yamllint,
    t_actionlint,
]


def main() -> int:
    _ensure_venv_on_path()
    tools = CI_TOOLS if IS_CI else LOCAL_TOOLS
    label = "scripts/lint-all.py (CI)" if IS_CI else "scripts/lint-all.py (local)"

    print("\n=== Carameli Lint Suite ===")
    print(f"Artifact : {REPO_ROOT / 'logs' / 'lint-errors.log'}")
    print(f"Mode     : {'CI' if IS_CI else 'local'} (parallel)\n")
    print("Running all linters in parallel...")

    results: dict[str, tuple[list[str], int]] = {}
    with ThreadPoolExecutor(max_workers=len(tools)) as ex:
        for fut in [ex.submit(t) for t in tools]:
            results.update(fut.result())

    any_failed, text, skips = diagnostics.digest_lint(results, label)

    for name, (_, code) in sorted(results.items()):
        if code != 0 and not any(name == s for s, _ in skips):
            print(f"  [FAIL] {name}")
    for name, reason in skips:
        print(f"  [skip] {name} ({reason})")

    logs = REPO_ROOT / "logs"
    logs.mkdir(exist_ok=True)
    (logs / "lint-errors.log").write_text(text, encoding="utf-8")

    if any_failed:
        print(f"\nErrors written to: {logs / 'lint-errors.log'}")
        print("\n  ==========================================")
        print("               LINT FAILED")
        print("  ==========================================\n")
        return 1
    print("\n  ==========================================")
    print("              LINT PASSED")
    print("  ==========================================\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
