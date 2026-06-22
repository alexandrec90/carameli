#!/usr/bin/env python3
"""
CI artifact digest.

Reads linter and pytest outputs captured by on-demand.yml (reports/<tool>.txt
+ reports/<tool>.exit) and produces the same artifact format as the local PS1
diagnostic scripts:

  logs/lint-errors.log   (same format as scripts/lint-all.ps1)
  logs/test-failures.log (same format as scripts/run-tests.ps1)

Usage: python scripts/ci-digest.py  (run from repo root)
"""
import re
import sys
from pathlib import Path

REPORTS = Path("reports")
LOGS = Path("logs")
MAX_PER_BLOCK = 25

# Provenance header stamped on non-empty artifacts so the fix-lint / fix-tests skills can
# name the script to edit if a filter swallowed actionable lines, without guessing the env.
SOURCE_HEADER = "# source: scripts/ci-digest.py (CI)"

_MISSING_TOOL = [
    "ModuleNotFoundError", "command not found", "not recognized",
    "is not installed", "Cannot find", "could not be found",
]
_ENV_ERROR = [
    "ConnectionRefusedError", "InvalidPasswordError", "OperationalError",
    "authentication failed", "could not connect", "connection refused",
    "timeout expired", "Cannot connect to the Docker daemon",
    "No such container", "No such service", "is not running",
    "error during connect",
]


def get_skip_reason(lines: list[str]) -> str | None:
    text = "\n".join(lines)
    if any(p in text for p in _MISSING_TOOL):
        return "not installed"
    if any(p in text for p in _ENV_ERROR):
        return "environment error"
    return None


def read_report(name: str) -> tuple[list[str], int]:
    txt = REPORTS / f"{name}.txt"
    exit_file = REPORTS / f"{name}.exit"
    lines = txt.read_text(encoding="utf-8", errors="replace").splitlines() if txt.exists() else []
    code = 0
    if exit_file.exists():
        try:
            code = int(exit_file.read_text().strip())
        except ValueError:
            code = 1
    return lines, code


def _section(sections: list[str], name: str, fix_hint: str, errs: list[str]) -> None:
    sections.append(f"# {name}")
    if fix_hint:
        sections.append(f"# fix: {fix_hint}")
    sections.extend(errs if errs else [
        "(exit code indicated failure but no parseable error lines"
        " -- re-run the tool manually)"
    ])
    sections.append("")


def _denoise(lines: list[str]) -> list[str]:
    return [
        l for l in lines
        if l.strip() and not l.startswith("> ") and not l.startswith("npm warn") and not l.startswith("npm error")
    ]


def digest_lint() -> bool:
    LOGS.mkdir(exist_ok=True)
    sections: list[str] = []
    any_failed = False

    def process(name: str, fix_hint: str, keep) -> None:
        nonlocal any_failed
        lines, code = read_report(name)
        if code == 0:
            return
        skip = get_skip_reason(lines)
        if skip:
            print(f"  [skip] {name} ({skip})")
            return
        any_failed = True
        errs = [l for l in lines if keep(l)]
        if not errs:
            errs = _denoise(lines)
        _section(sections, name, fix_hint, errs)

    process(
        "ruff-check",
        "ruff check . --fix --unsafe-fixes",
        lambda l: l.strip() and not re.match(r"^Found \d+ error", l),
    )
    process(
        "ruff-format",
        "ruff format .",
        lambda l: "Would reformat" in l or bool(re.match(r"^\d+ file", l)),
    )
    process(
        "mypy",
        "mypy app/",
        lambda l: ": error:" in l or ": note:" in l,
    )
    process(
        "eslint",
        "npm --prefix frontend run lint:eslint -- --fix",
        lambda l: bool(re.search(r"\s(error|warning)\s", l)) or bool(re.match(r"^\S.*\.(ts|tsx|js)", l)),
    )
    process(
        "tsc",
        "npm --prefix frontend run lint:types",
        lambda l: bool(re.search(r"error TS\d+", l)),
    )
    process(
        "stylelint",
        "npm --prefix frontend run lint:css -- --fix",
        lambda l: bool(re.search(r":\d+:\d+.*(error|warning)", l)),
    )
    process(
        "markdownlint",
        'npm --prefix frontend exec -- markdownlint "**/*.md" --fix',
        lambda l: bool(re.search(r":\d+:\d+", l)) or bool(re.search(r":\d+ ", l)),
    )
    process(
        "pip-audit",
        "pip install --upgrade <package>  # update vulnerable dependencies",
        lambda l: bool(re.search(r"PYSEC|CVE|vulnerability|Name|---", l)),
    )
    process(
        "vulture",
        "# remove unused code at the reported locations",
        lambda l: "unused" in l,
    )
    process(
        "yamllint",
        "yamllint --strict -f parsable <file>",
        lambda l: bool(re.search(r":\d+:\d+:.*\[(warning|error)\]", l)),
    )
    process(
        "actionlint",
        "actionlint",
        lambda l: bool(re.search(r":\d+:\d+:", l)),
    )

    # alembic-check: synthesise a file locator when none is present so the
    # agent can find where to look (env.py:1:1 is a convention, not literal).
    lines, code = read_report("alembic-check")
    if code != 0:
        skip = get_skip_reason(lines)
        if skip:
            print(f"  [skip] alembic-check ({skip})")
        else:
            any_failed = True
            errs = [l for l in lines if l.strip()]
            if not any(re.match(r"^[^:\s].+:\d+:\d+", l) for l in errs):
                summary = errs[-1] if errs else "alembic check failed"
                errs = [f"alembic/versions/env.py:1:1: [alembic-check] {summary}", *errs]
            _section(
                sections,
                "alembic-check",
                "alembic revision --autogenerate -m 'describe change'",
                errs,
            )

    artifact = LOGS / "lint-errors.log"
    artifact.write_text("\n".join([SOURCE_HEADER, "", *sections]) if any_failed else "", encoding="utf-8")
    return any_failed


def filter_pytest_output(lines: list[str]) -> list[str]:
    """Apply the same filtering logic as run-tests.ps1 Invoke-FlushBlock."""
    filtered: list[str] = []
    in_block = False
    block_lines: list[str] = []
    raw_block_lines: list[str] = []

    def flush_block() -> None:
        nonlocal block_lines, raw_block_lines
        if not block_lines and not raw_block_lines:
            block_lines = []
            raw_block_lines = []
            return
        source = list(block_lines)
        is_raw_fallback = False
        if not any(re.match(r"^E\s+", l) for l in source) and len(raw_block_lines) > len(block_lines):
            source = list(raw_block_lines)
            is_raw_fallback = True
        if len(source) > MAX_PER_BLOCK:
            kept = len(source)
            source = [*source[:MAX_PER_BLOCK], f"  ... ({kept} lines total, truncated)"]
        if is_raw_fallback:
            source = [*source, "  [raw fallback: no E-lines in filtered output]"]
        filtered.extend(source)
        filtered.append("")
        block_lines = []
        raw_block_lines = []

    i = 0
    while i < len(lines):
        l = lines[i]

        if re.match(r"^={3,}\s+test session starts", l):
            i += 1
            continue

        if re.match(r"^={3,}\s+short test summary", l):
            flush_block()
            in_block = False
            filtered.append(l)
            i += 1
            continue

        if re.match(r"^={3,}\s+(FAILURES|ERRORS)\s+=", l):
            in_block = True
            filtered.append(l)
            i += 1
            continue

        if re.match(r"^_{3,}\s+", l):
            flush_block()
            block_lines.append(l)
            raw_block_lines.append(l)
            i += 1
            continue

        if not in_block:
            if re.match(r"^(FAILED |ERROR |=)", l) and not re.match(r"^\s*=+\s+\d+\s+(failed|passed|error)", l):
                filtered.append(l)
        else:
            if re.match(r"^-+ Captured log call", l):
                i += 1
                while i < len(lines):
                    if re.match(r"^(_{3,}|={3,}|-+ Captured)", lines[i]):
                        i -= 1
                        break
                    if re.match(r"^(WARNING|ERROR|CRITICAL)\s+", lines[i]):
                        block_lines.append(lines[i])
                        raw_block_lines.append(lines[i])
                    i += 1
            elif re.match(r"^-+ Captured (stderr|stdout)", l):
                i += 1
                while i < len(lines):
                    if re.match(r"^(_{3,}|={3,}|-+ Captured)", lines[i]):
                        i -= 1
                        break
                    i += 1
            elif re.match(r"^(INFO|DEBUG)\s+\S+:\S+\.py:\d+", l):
                pass  # test fixture noise
            else:
                raw_block_lines.append(l)
                if re.match(r"^E\s+", l) or re.search(r"(tests/|app/).*\.py:\d+", l) or re.match(r"^(WARNING|ERROR|CRITICAL)\s+", l):
                    block_lines.append(l)
                elif re.match(r"^\s*[|+]", l):
                    if re.match(r"^\s*\|\s*$", l):
                        pass  # blank spacer
                    elif 'File "' in l and not re.search(r"(tests/|app/)", l):
                        pass  # library internal frame
                    else:
                        block_lines.append(l)

        i += 1

    flush_block()

    for l in reversed(lines):
        if re.match(r"^\s*=+\s+\d+\s+(failed|passed|error)", l):
            filtered.append(l)
            break

    return filtered


# Each test source: (report name, section header, parser, fix hint). pytest-format
# runners reuse filter_pytest_output; other runners (vitest) get generic denoising.
_TEST_SOURCES = [
    ("pytest", "pytest", filter_pytest_output, "pytest tests/unit/ <path::to::failing_test>"),
    ("hook-tests", "hook-tests", filter_pytest_output, "pytest scripts/hooks/tests"),
    ("frontend-tests", "frontend-tests", _denoise, "npm --prefix frontend run test:run"),
]


def digest_tests() -> bool:
    LOGS.mkdir(exist_ok=True)
    sections: list[str] = []
    any_failed = False

    for name, header, parser, fix_hint in _TEST_SOURCES:
        lines, code = read_report(name)
        if code == 0:
            continue
        skip = get_skip_reason(lines)
        if skip:
            print(f"  [skip] {name} ({skip})")
            continue
        any_failed = True
        body = parser(lines)
        sections.append(f"# {header}")
        sections.append(f"# fix: {fix_hint}")
        sections.extend(body if body else [
            "(exit code indicated failure but no parseable lines -- re-run the runner manually)"
        ])
        sections.append("")

    artifact = LOGS / "test-failures.log"
    artifact.write_text("\n".join([SOURCE_HEADER, "", *sections]) if any_failed else "", encoding="utf-8")
    return any_failed


if __name__ == "__main__":
    lint_failed = digest_lint()
    test_failed = digest_tests()
    sys.exit(1 if (lint_failed or test_failed) else 0)
