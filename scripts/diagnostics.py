#!/usr/bin/env python3
"""Shared diagnostic filtering + digest logic for the lint and test runners.

`scripts/lint-all.py` and `scripts/run-tests.py` run the tools (locally via
Docker / host tools, or directly in CI) and pass the captured output here. This
module owns the **single source of truth** for:

  - classifying environment / missing-tool failures (skip, don't report)
  - per-tool output filtering (keep only actionable, self-locating lines)
  - the `logs/lint-errors.log` and `logs/test-failures.log` artifact format

Pure functions only -- no subprocess, no file writes -- so it is unit-tested
directly (`scripts/hooks/tests/test_diagnostics.py`). Both runners build an
in-memory `results` dict (`{tool: (output_lines, exit_code)}`) and hand it to
`digest_lint` / `digest_tests`, which return `(any_failed, artifact_text, skips)`.
The caller writes the artifact and prints the skip notes.
"""
import re

MAX_PER_BLOCK = 25

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


def source_header(label: str) -> str:
    """Provenance stamp on non-empty artifacts.

    Lets the fix-lint / fix-tests skills name the producing script if a filter
    swallowed actionable lines, without guessing the environment.
    """
    return f"# source: {label}"


def get_skip_reason(lines: list[str]) -> str | None:
    """Return a skip reason for environmental / missing-tool failures, else None.

    These pollute the artifact with content the agent cannot fix, so the runners
    emit a one-line skip note to the terminal instead of writing a section.
    """
    text = "\n".join(lines)
    if any(p in text for p in _MISSING_TOOL):
        return "not installed"
    if any(p in text for p in _ENV_ERROR):
        return "environment error"
    return None


def denoise(lines: list[str]) -> list[str]:
    """Drop npm script echoes, npm warnings/errors, and blank lines."""
    return [
        l for l in lines
        if l.strip() and not l.startswith("> ")
        and not l.startswith("npm warn") and not l.startswith("npm error")
    ]


def _section(sections: list[str], name: str, fix_hint: str, errs: list[str]) -> None:
    sections.append(f"# {name}")
    if fix_hint:
        sections.append(f"# fix: {fix_hint}")
    sections.extend(errs if errs else [
        "(exit code indicated failure but no parseable error lines"
        " -- re-run the tool manually)"
    ])
    sections.append("")


# ---------------------------------------------------------------------------
# Lint section filters. Each keeps only the actionable, self-locating lines for
# one tool; if filtering strips everything, the caller falls back to denoise().
# ---------------------------------------------------------------------------

def _keep_ruff_check(l: str) -> bool:
    return bool(l.strip()) and not re.match(r"^Found \d+ error", l)


def _keep_ruff_format(l: str) -> bool:
    return "Would reformat" in l or bool(re.match(r"^\d+ file", l))


def _keep_mypy(l: str) -> bool:
    return ": error:" in l or ": note:" in l


def _keep_eslint(l: str) -> bool:
    return bool(re.search(r"\s(error|warning)\s", l)) or bool(re.match(r"^\S.*\.(ts|tsx|js)", l))


def _keep_tsc(l: str) -> bool:
    return bool(re.search(r"error TS\d+", l))


def _keep_stylelint(l: str) -> bool:
    return bool(re.search(r":\d+:\d+.*(error|warning)", l))


def _keep_markdownlint(l: str) -> bool:
    return bool(re.search(r":\d+:\d+", l)) or bool(re.search(r":\d+ ", l))


def _keep_pip_audit(l: str) -> bool:
    return bool(re.search(r"PYSEC|CVE|vulnerability|Name|---", l))


def _keep_vulture(l: str) -> bool:
    return "unused" in l


def _keep_detect_secrets(l: str) -> bool:
    return bool(re.search(r"Secret|Potential|ERROR", l)) or "Location:" in l


def _keep_dotenv(l: str) -> bool:
    return ".env" in l


def _keep_yamllint(l: str) -> bool:
    return bool(re.search(r":\d+:\d+:.*\[(warning|error)\]", l))


def _keep_actionlint(l: str) -> bool:
    return bool(re.search(r":\d+:\d+:", l))


def _keep_lint_instructions(l: str) -> bool:
    return bool(re.search(r":\d+: \[", l))


# (report name, fix hint, keep filter). alembic-check is handled separately
# because it synthesises a file locator when the tool emits none.
LINT_SECTIONS = [
    ("ruff-check", "ruff check . --fix --unsafe-fixes", _keep_ruff_check),
    ("ruff-format", "ruff format .", _keep_ruff_format),
    ("mypy", "mypy app/", _keep_mypy),
    ("eslint", "npm --prefix frontend run lint:eslint -- --fix", _keep_eslint),
    ("tsc", "npm --prefix frontend run lint:types", _keep_tsc),
    ("stylelint", "npm --prefix frontend run lint:css -- --fix", _keep_stylelint),
    ("markdownlint", 'npm --prefix frontend exec -- markdownlint "**/*.md" --fix', _keep_markdownlint),
    ("pip-audit", "pip install --upgrade <package>  # update vulnerable dependencies", _keep_pip_audit),
    ("vulture", "# remove unused code at the reported locations", _keep_vulture),
    ("detect-secrets", "detect-secrets scan --update .secrets.baseline", _keep_detect_secrets),
    ("dotenv-linter", "# fix ordering / quoting in the reported .env file", _keep_dotenv),
    ("yamllint", "yamllint --strict -f parsable <file>", _keep_yamllint),
    ("actionlint", "actionlint", _keep_actionlint),
    ("lint-instructions", "python scripts/lint-instructions.py", _keep_lint_instructions),
]


def digest_lint(results: dict[str, tuple[list[str], int]], source_label: str):
    """Build `logs/lint-errors.log` from in-memory per-tool results.

    Returns `(any_failed, artifact_text, skips)`. A tool absent from `results`
    (e.g. not run in this environment) is treated as a clean pass.
    """
    sections: list[str] = []
    skips: list[tuple[str, str]] = []
    any_failed = False

    for name, fix_hint, keep in LINT_SECTIONS:
        lines, code = results.get(name, ([], 0))
        if code == 0:
            continue
        skip = get_skip_reason(lines)
        if skip:
            skips.append((name, skip))
            continue
        any_failed = True
        errs = [l for l in lines if keep(l)] or denoise(lines)
        _section(sections, name, fix_hint, errs)

    # alembic-check: synthesise a file locator when none is present so the agent
    # can find where to look (env.py:1:1 is a convention, not a literal line).
    lines, code = results.get("alembic-check", ([], 0))
    if code != 0:
        skip = get_skip_reason(lines)
        if skip:
            skips.append(("alembic-check", skip))
        else:
            any_failed = True
            errs = [l for l in lines if l.strip()]
            if not any(re.match(r"^[^:\s].+:\d+:\d+", l) for l in errs):
                summary = errs[-1] if errs else "alembic check failed"
                errs = [f"alembic/versions/env.py:1:1: [alembic-check] {summary}", *errs]
            _section(
                sections, "alembic-check",
                "alembic revision --autogenerate -m 'describe change'", errs,
            )

    text = "\n".join([source_header(source_label), "", *sections]) if any_failed else ""
    return any_failed, text, skips


# ---------------------------------------------------------------------------
# pytest filtering -- keeps, per failure/error block, only first-party frames
# (tests/ or app/), E-lines, WARNING+ captured logs, exception-group content,
# and the final stats line. Library internals and INFO/DEBUG noise are dropped.
# Each block is capped; if filtering removes everything actionable it falls back
# to the raw block so the agent always has something to work with.
# ---------------------------------------------------------------------------

def filter_pytest_output(lines: list[str]) -> list[str]:
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


# (report name, section header, parser, fix hint). pytest-format runners reuse
# filter_pytest_output; other runners (vitest) get generic denoising.
TEST_SECTIONS = [
    ("pytest", "pytest", filter_pytest_output, "pytest tests/unit/ <path::to::failing_test>"),
    ("hook-tests", "hook-tests", filter_pytest_output, "pytest scripts/hooks/tests"),
    ("frontend-tests", "frontend-tests", denoise, "npm --prefix frontend run test:run"),
]


def digest_tests(results: dict[str, tuple[list[str], int]], source_label: str):
    """Build `logs/test-failures.log` from in-memory per-source results.

    Returns `(any_failed, artifact_text, skips)`. A source absent from `results`
    is treated as a clean pass.
    """
    sections: list[str] = []
    skips: list[tuple[str, str]] = []
    any_failed = False

    for name, header, parser, fix_hint in TEST_SECTIONS:
        lines, code = results.get(name, ([], 0))
        if code == 0:
            continue
        skip = get_skip_reason(lines)
        if skip:
            skips.append((name, skip))
            continue
        any_failed = True
        body = parser(lines)
        sections.append(f"# {header}")
        sections.append(f"# fix: {fix_hint}")
        sections.extend(body if body else [
            "(exit code indicated failure but no parseable lines -- re-run the runner manually)"
        ])
        sections.append("")

    text = "\n".join([source_header(source_label), "", *sections]) if any_failed else ""
    return any_failed, text, skips
