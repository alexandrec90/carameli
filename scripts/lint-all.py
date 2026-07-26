#!/usr/bin/env python3
"""Runs all linters (in parallel), then writes actionable failures to
`logs/lint-errors.log` for AI-agent consumption. On pass, clears the artifact.

One entrypoint for every environment:
  - **Local desktop:** `python scripts/lint-all.py`
    Runs host tools from the venv; `alembic check` runs inside the app container.
  - **CI (GitHub Actions):** `python scripts/lint-all.py` with `CI=true` set.
    Runs the same host tools directly (no Docker stack); `alembic check` runs
    against the service Postgres. Genuine, unfixable findings fail this run.
    Auto-fixes land in the working tree but are cosmetic and non-blocking — the
    lint-fix PostToolUse hook applies them on-edit, so the PR Gate reports any
    residual drift as a notice rather than failing on it.

Two scoping modes:
  - **Full (default):** every tool runs over the whole tree.
  - **Changed (`--changed`, or `--paths <files...>`):** lint only the working-tree
    diff. File-scopable host tools (ruff / mypy / vulture) run on just the changed
    files; the frontend tools (eslint / tsc / stylelint / markdownlint) and the
    project-global tools (pip-audit / alembic / yamllint / actionlint / ...) run
    their normal command only when a relevant file changed, else skip cleanly.
    `/fix-all` uses this to relint after `/fix-tests` edits source, so a lint
    violation introduced by a test fix is caught before CI.

Filtering / artifact format live in `scripts/diagnostics.py` (the single source
of truth shared with `scripts/run-tests.py`), so local and CI never drift — and
both scoping modes hand the same `results` dict to `digest_lint`, so the artifact
`/fix-lint` consumes is byte-identical regardless of scope.
"""

import argparse
import os
import re
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import diagnostics
import script_common

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
# Changed-files scoping. `changed_files()` returns the repo-relative paths to
# lint in --changed mode; the `_is_*` predicates classify a path so each tool can
# decide whether it is relevant (and, for the host tools, which files to target).
# All paths are repo-relative with forward slashes, as git emits them.
# ---------------------------------------------------------------------------

_FE_SCRIPT_EXT = (".ts", ".tsx", ".js", ".jsx")


def changed_files(paths: list[str] | None = None) -> list[str]:
    """Repo-relative paths to lint in --changed mode.

    With explicit `paths`, use those; otherwise derive the set from git — tracked
    edits vs HEAD plus untracked files. Either way, drop entries that no longer
    exist on disk (deleted paths have nothing to lint) and de-duplicate.
    """
    if paths is not None:
        cand = paths
    else:
        tracked, _ = run("git diff --name-only HEAD")
        untracked, _ = run("git ls-files --others --exclude-standard")
        cand = [*tracked, *untracked]
    out: list[str] = []
    for raw in cand:
        f = raw.strip()
        if f and f not in out and (REPO_ROOT / f).exists():
            out.append(f)
    return out


def _sel(changed: list[str], pred) -> list[str]:
    return [f for f in changed if pred(f)]


def _q(files: list[str]) -> str:
    """Shell-quote a file list for a `run()` command (shell=True)."""
    return " ".join(f'"{f}"' for f in files)


def _is_py(f: str) -> bool:
    return f.endswith(".py")


def _is_app_py(f: str) -> bool:
    return f.endswith(".py") and f.startswith("app/")


def _is_fe_script(f: str) -> bool:
    return f.startswith("frontend/") and f.endswith(_FE_SCRIPT_EXT)


def _is_fe_css(f: str) -> bool:
    return f.startswith("frontend/") and f.endswith(".css")


def _is_md(f: str) -> bool:
    return f.endswith(".md")


def _is_req(f: str) -> bool:
    return f.startswith("requirements") and f.endswith((".txt", ".in"))


def _is_env(f: str) -> bool:
    return Path(f).name.startswith(".env")


def _is_migration(f: str) -> bool:
    return f.startswith("app/models/") or f.startswith("alembic/")


def _is_yaml(f: str) -> bool:
    return f.endswith((".yml", ".yaml"))


def _is_workflow(f: str) -> bool:
    return f.startswith(".github/workflows/")


def _is_instruction(f: str) -> bool:
    return f in ("CLAUDE.md", "AGENTS.md") or f.startswith((".claude/", ".agents/"))


# ---------------------------------------------------------------------------
# Per-tool runners. Each returns {report_name: (lines, exit_code)}. Tools that
# auto-fix do so before the reporting pass so only unfixable issues are reported.
#
# Each accepts `changed`: None in full mode (lint the whole tree, the historical
# behaviour), or the changed-file list in --changed mode. A tool with no relevant
# change returns ([], 0) (a clean pass), which `digest_lint` omits entirely.
# ---------------------------------------------------------------------------


def t_ruff(changed: list[str] | None = None) -> dict:
    # Fix then format sequentially (format after fix) before the reporting pass.
    if changed is None:
        target = "."
    else:
        target = _q(_sel(changed, _is_py))
        if not target:
            return {"ruff-check": ([], 0), "ruff-format": ([], 0)}
    run(f"ruff check {target} --fix --unsafe-fixes --quiet")
    run(f"ruff format {target} --quiet")
    return {
        "ruff-check": run(f"ruff check {target} --output-format=full"),
        "ruff-format": run(f"ruff format --check {target}"),
    }


def t_eslint(changed: list[str] | None = None) -> dict:
    # eslint's npm script targets `src` wholesale; scope by gating on relevance
    # rather than per-file (the lint of `src` is cheap relative to the diff math).
    if changed is not None and not _sel(changed, _is_fe_script):
        return {"eslint": ([], 0)}
    return {"eslint": run("npm --prefix frontend run lint:eslint -- --fix")}


def t_tsc(changed: list[str] | None = None) -> dict:
    # tsc cannot scope to single files (whole-project type-check), so gate on any
    # frontend script change and otherwise run the normal project check.
    if changed is not None and not _sel(changed, _is_fe_script):
        return {"tsc": ([], 0)}
    return {"tsc": run("npm --prefix frontend run lint:types")}


def t_stylelint(changed: list[str] | None = None) -> dict:
    if changed is not None and not _sel(changed, _is_fe_css):
        return {"stylelint": ([], 0)}
    return {"stylelint": run("npm --prefix frontend run lint:css -- --fix")}


def t_markdownlint(changed: list[str] | None = None) -> dict:
    if changed is not None and not _sel(changed, _is_md):
        return {"markdownlint": ([], 0)}
    return {
        # Captured agent transcripts (e.g. "artifacts/transcripts/fixer-run-transcript.md")
        # are raw tool output, not prose -- they legitimately carry inline HTML
        # and fenced code, generating hundreds of unfixable findings that bury
        # real markdown errors. Exclude any *transcript*.md from the lint.
        "markdownlint": run(
            'npm --prefix frontend exec --yes -- markdownlint "**/*.md" '
            '--ignore "**/node_modules/**" --ignore "**/.git/**" --ignore "**/.venv/**" '
            '--ignore "**/*transcript*.md" '
            '-c ".markdownlint.json" --fix'
        )
    }


def t_mypy(changed: list[str] | None = None) -> dict:
    if changed is None:
        return {"mypy": run("mypy app/")}
    files = _sel(changed, _is_app_py)
    if not files:
        return {"mypy": ([], 0)}
    return {"mypy": run(f"mypy {_q(files)}")}


def t_vulture(changed: list[str] | None = None) -> dict:
    opts = '--min-confidence 80 --ignore-names "cls,ctx,opts"'
    if changed is None:
        return {"vulture": run(f"vulture app/ {opts}")}
    files = _sel(changed, _is_app_py)
    if not files:
        return {"vulture": ([], 0)}
    return {"vulture": run(f"vulture {_q(files)} {opts}")}


def t_pip_audit(changed: list[str] | None = None) -> dict:
    # Report-only: never `pip install --upgrade` from here. Unconstrained upgrades
    # (majors included) silently drift the local venv from requirements.txt and CI;
    # vulnerable packages are fixed by a reviewed dependency bump that updates the
    # manifest and passes the PR gate, not as a lint side effect.
    if changed is not None and not _sel(changed, _is_req):
        return {"pip-audit": ([], 0)}
    return {"pip-audit": run("pip-audit --ignore-vuln CVE-2026-4539")}


def t_alembic_check(changed: list[str] | None = None) -> dict:
    # Migration drift only depends on the models / migration tree.
    if changed is not None and not _sel(changed, _is_migration):
        return {"alembic-check": ([], 0)}
    # In CI the service Postgres is fresh-migrated, so a direct check is valid.
    if IS_CI:
        return {"alembic-check": run("alembic check")}
    # Locally the shared dev DB's schema is owned by the test suite (create_all +
    # TRUNCATE, never alembic-stamped -- see tests/conftest.py), so checking against
    # it reports DB-state noise ("Target database is not up to date") instead of
    # code drift. Check against a fresh throwaway database instead: migrate from
    # scratch, then compare models vs migrations.
    return {"alembic-check": _alembic_check_fresh_db()}


def _alembic_check_fresh_db() -> tuple[list[str], int]:
    """Run `alembic upgrade head` + `alembic check` against a throwaway database.

    The throwaway DB isolates the drift check from local test-suite schema state.
    Environment failures (stack down, DB unreachable) skip with a terminal note --
    they are not code errors and must not reach the artifact.
    """
    lint_db = "carameli_lint_check"
    # Derive the connection URL from the app container env (single source:
    # docker-compose.yml) instead of duplicating credentials here. DIRECT_DATABASE_URL
    # bypasses PgBouncer, which alembic needs anyway.
    url_lines, rc = run("docker compose exec -T app printenv DIRECT_DATABASE_URL")
    if rc != 0 or not url_lines or "://" not in url_lines[-1]:
        print("  [skip] alembic-check: app container not reachable (stack down?)")
        return ([], 0)
    url = url_lines[-1].strip().rsplit("/", 1)[0] + f"/{lint_db}"
    # User/dbname mirror the POSTGRES_* values in docker-compose.yml.
    psql = "docker compose exec -T db psql -U carameli -d carameli -q -c"
    run(f'{psql} "DROP DATABASE IF EXISTS {lint_db};"')
    _, rc = run(f'{psql} "CREATE DATABASE {lint_db};"')
    if rc != 0:
        print("  [skip] alembic-check: could not create throwaway database")
        return ([], 0)
    try:
        exec_app = f'docker compose exec -T -e DATABASE_URL="{url}" app'
        out, rc = run(f"{exec_app} alembic upgrade head")
        if rc != 0:
            return (out, rc)  # broken migration chain -- actionable code error
        return run(f"{exec_app} alembic check")
    finally:
        run(f'{psql} "DROP DATABASE IF EXISTS {lint_db};"')


def t_yamllint(changed: list[str] | None = None) -> dict:
    if changed is not None and not _sel(changed, _is_yaml):
        return {"yamllint": ([], 0)}
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


def t_actionlint(changed: list[str] | None = None) -> dict:
    if changed is not None and not _sel(changed, _is_workflow):
        return {"actionlint": ([], 0)}
    wf = REPO_ROOT / ".github" / "workflows"
    if not wf.exists() or not list(wf.glob("*.yml")):
        return {"actionlint": ([], 0)}
    if not shutil.which("actionlint"):
        return {"actionlint": ([], 0)}
    return {"actionlint": run("actionlint")}


def t_lint_instructions(changed: list[str] | None = None) -> dict:
    if changed is not None and not _sel(changed, _is_instruction):
        return {"lint-instructions": ([], 0)}
    return {"lint-instructions": run("python scripts/lint-instructions.py")}


def t_dotenv(changed: list[str] | None = None) -> dict:
    if changed is not None and not _sel(changed, _is_env):
        return {"dotenv-linter": ([], 0)}
    envs = [p.name for p in sorted(REPO_ROOT.glob(".env*")) if p.is_file()]
    if not envs:
        return {"dotenv-linter": ([], 0)}
    return {"dotenv-linter": run("dotenv-linter check " + " ".join(envs))}


def t_detect_secrets(changed: list[str] | None = None) -> dict:
    """Scan for secrets; auto-acknowledge new findings into the baseline.

    detect-secrets never blocks the suite -- real secrets surface in
    `git diff .secrets.baseline` for review. New findings are detected by whether
    `scan --baseline` actually changed the baseline's results (ignoring the
    `generated_at` timestamp, which churns every run and is restored when it is the
    only change), so a reported count always matches what `git diff` will show.
    NB: the update flag is `--baseline`; `--update` does not exist in detect-secrets
    1.5 -- the old call using it failed silently, which is why findings were
    re-reported as "new" on every run without ever landing in the baseline.
    """
    import json

    # The scan reads the whole tree; only worth it when a non-baseline file moved.
    if changed is not None and not _sel(changed, lambda f: f != ".secrets.baseline"):
        return {"detect-secrets": ([], 0)}

    exclude = '--exclude-files "\\.secrets\\.baseline"'
    baseline = REPO_ROOT / ".secrets.baseline"

    if not baseline.exists():
        out, _ = run(f"detect-secrets scan {exclude}")
        baseline.write_text("\n".join(out), encoding="utf-8")
        return {"detect-secrets": ([], 0)}

    before = baseline.read_text(encoding="utf-8")
    _, code = run(f'detect-secrets scan --baseline ".secrets.baseline" {exclude}')
    if code != 0:
        return {"detect-secrets": ([f"detect-secrets: baseline scan failed (exit {code})"], 1)}
    after = baseline.read_text(encoding="utf-8")

    def _normalize(text: str) -> str:
        return re.sub(r'"generated_at":\s*"[^"]*"', '"generated_at": ""', text)

    if _normalize(after) == _normalize(before):
        if after != before:
            # Timestamp-only churn: restore so the committed baseline stays clean.
            baseline.write_text(before, encoding="utf-8")
        return {"detect-secrets": ([], 0)}

    def _hashes(text: str) -> set[tuple[str, str]]:
        try:
            data = json.loads(text)
        except ValueError:
            return set()
        return {
            (file, s.get("hashed_secret", ""))
            for file, secrets in (data.get("results") or {}).items()
            for s in secrets
        }

    added = _hashes(after) - _hashes(before)
    if added:
        print(
            f"  [auto-fix] detect-secrets: {len(added)} new finding(s) added to "
            ".secrets.baseline -- review with: git diff .secrets.baseline"
        )
    else:
        print(
            "  [auto-fix] detect-secrets: baseline entries updated (removed/relocated)"
            " -- review with: git diff .secrets.baseline"
        )
    return {"detect-secrets": ([], 0)}


# CI runs every tool the desktop lint task runs, minus detect-secrets, which
# mutates the committed baseline — the local pre-commit hook owns secrets.
# There is no other local enforcement: the pre-commit lint hooks are gone, so
# any tool missing from CI_TOOLS is not enforced anywhere.
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
CI_TOOLS = [t for t in LOCAL_TOOLS if t is not t_detect_secrets]


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument(
        "--changed",
        action="store_true",
        help="Lint only the working-tree diff (vs HEAD, plus untracked), skipping "
        "tools with no relevant change.",
    )
    p.add_argument(
        "--paths",
        nargs="*",
        default=None,
        metavar="FILE",
        help="Explicit repo-relative paths to treat as the changed set (implies "
        "--changed; overrides git detection).",
    )
    p.add_argument(
        "--no-secrets",
        action="store_true",
        help="Skip the detect-secrets scan (the one always-on tool). Used by the "
        "Stop hook: detect-secrets is owned by the pre-commit hook, already "
        "excluded from CI_TOOLS, and its full-tree scan is the only per-run cost "
        "(and baseline-churn source) not worth paying on every stop.",
    )
    return p.parse_args(argv)


def select_tools(is_ci: bool, no_secrets: bool = False):
    """The tool set to run. CI drops detect-secrets already; `no_secrets` drops it
    for local callers (the Stop hook) that leave it to the pre-commit hook."""
    tools = CI_TOOLS if is_ci else LOCAL_TOOLS
    if no_secrets:
        tools = [t for t in tools if t is not t_detect_secrets]
    return tools


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    _ensure_venv_on_path()
    tools = select_tools(IS_CI, args.no_secrets)

    if args.paths is not None:
        changed: list[str] | None = changed_files(args.paths)
    elif args.changed:
        changed = changed_files()
    else:
        changed = None

    env = "CI" if IS_CI else "local"
    scope = "full" if changed is None else f"changed ({len(changed)} file(s))"
    label = f"scripts/lint-all.py ({env}{'' if changed is None else ', changed'})"

    artifact = REPO_ROOT / "logs" / "lint-errors.log"
    script_common.print_suite_header(
        "Lint Suite",
        artifact,
        [
            f"Mode     : {env} (parallel)",
            f"Scope    : {scope}",
            "",
            "Running all linters in parallel...",
        ],
    )

    results: dict[str, tuple[list[str], int]] = {}
    with ThreadPoolExecutor(max_workers=len(tools)) as ex:
        for fut in [ex.submit(t, changed) for t in tools]:
            results.update(fut.result())

    any_failed, text, skips = diagnostics.digest_lint(results, label)

    skipped = {s for s, _ in skips}
    statuses = [
        (script_common.FAIL, name)
        for name, (_, code) in sorted(results.items())
        if code != 0 and name not in skipped
    ]
    statuses += [(script_common.SKIP, f"{name} ({reason})") for name, reason in skips]

    # Lint's unit is the check, not a test: count passing vs failing vs skipped.
    failed_checks = sum(
        1 for name, (_, code) in results.items() if code != 0 and name not in skipped
    )
    passed_checks = sum(1 for _, (_, code) in results.items() if code == 0)
    counts = (passed_checks, failed_checks, len(skips))

    return script_common.emit_report(
        noun="LINT",
        artifact_path=artifact,
        statuses=statuses,
        artifact_text=text,
        failed=any_failed,
        counts=counts,
        unit="checks",
    )


if __name__ == "__main__":
    sys.exit(main())
