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
# When a block is over the cap, keep this many lines from the END as well as the
# head. A failure that embeds a captured subprocess traceback (e.g. an Alembic
# CLI run asserted via its STDERR) carries the actual exception on the LAST lines;
# a head-only truncation would drop the root cause and keep only boilerplate.
TAIL_PER_BLOCK = 8

# Terminal colour / cursor escape sequences. pytest is invoked with --color=no,
# but vitest (and any other tool that ignores a no-colour flag) emits SGR codes
# that turn the artifact into unreadable `\x1b[31m...` noise an agent can't parse.
# Strip them on ingest so every section -- and the summary-count regexes that key
# off line starts -- sees plain text regardless of the producing tool.
_ANSI_RE = re.compile(r"\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])")


def strip_ansi(line: str) -> str:
    """Remove ANSI escape sequences from a single line. Pure."""
    return _ANSI_RE.sub("", line)


def strip_ansi_lines(lines: list[str]) -> list[str]:
    """Strip ANSI escapes from every line. Pure."""
    return [_ANSI_RE.sub("", l) for l in lines]


_MISSING_TOOL = [
    "ModuleNotFoundError",
    "command not found",
    "not recognized",
    "is not installed",
    "Cannot find",
    "could not be found",
    # Docker's wording when `docker compose exec <svc> <cmd>` can't find the
    # binary inside the container (a `bash -c` wrapper says "command not found").
    "executable file not found",
]
_ENV_ERROR = [
    "ConnectionRefusedError",
    "InvalidPasswordError",
    "OperationalError",
    "authentication failed",
    "could not connect",
    "connection refused",
    "timeout expired",
    "Cannot connect to the Docker daemon",
    "No such container",
    "No such service",
    "is not running",
    "error during connect",
]


def source_header(label: str) -> str:
    """Provenance stamp on non-empty artifacts.

    Lets a developer or agent identify the producing script if a filter swallowed
    actionable lines, without guessing the environment.
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
        l
        for l in lines
        if l.strip()
        and not l.startswith("> ")
        and not l.startswith("npm warn")
        and not l.startswith("npm error")
    ]


def last_resort(lines: list[str]) -> list[str]:
    """Whatever the tool printed, when every filter above discarded all of it.

    `denoise` drops `npm error` lines because they are normally the wrapper around a
    real finding. When npm *itself* is what failed they are the entire output, and
    dropping them leaves a red gate reporting "no parseable error lines" -- which sends
    the agent to re-run a command that will fail again identically, rather than to the
    cause. That is how the one MD040 in PR #129 reached CI: in an unprovisioned box the
    markdownlint step died with `npm error could not determine executable to run`, and
    every word of that was filtered away before the agent saw it.
    """
    return [l for l in lines if l.strip()]


def _section(sections: list[str], name: str, fix_hint: str, errs: list[str]) -> None:
    sections.append(f"# {name}")
    if fix_hint:
        sections.append(f"# fix: {fix_hint}")
    sections.extend(
        errs
        if errs
        else [
            "(exit code indicated failure but no parseable error lines -- re-run the tool manually)"
        ]
    )
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


# (report name, fix hint, keep filter). alembic-check is handled separately
# because it synthesises a file locator when the tool emits none.
LINT_SECTIONS = [
    ("ruff-check", "ruff check . --fix --unsafe-fixes", _keep_ruff_check),
    ("ruff-format", "ruff format .", _keep_ruff_format),
    ("mypy", "mypy app/", _keep_mypy),
    ("eslint", "npm --prefix frontend run lint:eslint -- --fix", _keep_eslint),
    ("tsc", "npm --prefix frontend run lint:types", _keep_tsc),
    ("stylelint", "npm --prefix frontend run lint:css -- --fix", _keep_stylelint),
    (
        "markdownlint",
        'npm --prefix frontend exec -- markdownlint "**/*.md" --fix',
        _keep_markdownlint,
    ),
    (
        "pip-audit",
        "pip install --upgrade <package>  # update vulnerable dependencies",
        _keep_pip_audit,
    ),
    ("vulture", "# remove unused code at the reported locations", _keep_vulture),
    ("detect-secrets", "detect-secrets scan --baseline .secrets.baseline", _keep_detect_secrets),
    ("dotenv-linter", "# fix ordering / quoting in the reported .env file", _keep_dotenv),
    ("yamllint", "yamllint --strict -f parsable <file>", _keep_yamllint),
    ("actionlint", "actionlint", _keep_actionlint),
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
        lines = strip_ansi_lines(lines)
        skip = get_skip_reason(lines)
        if skip:
            skips.append((name, skip))
            continue
        any_failed = True
        errs = [l for l in lines if keep(l)] or denoise(lines) or last_resort(lines)
        _section(sections, name, fix_hint, errs)

    # alembic-check: synthesise a file locator when none is present so the agent
    # can find where to look (env.py:1:1 is a convention, not a literal line).
    lines, code = results.get("alembic-check", ([], 0))
    if code != 0:
        lines = strip_ansi_lines(lines)
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
                sections,
                "alembic-check",
                "alembic revision --autogenerate -m 'describe change'",
                errs,
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


# A pytest run ends with `===== 1 failed, 34 passed, 3 skipped in 4.56s =====`;
# vitest with `  Tests  35 passed | 2 failed (37)`. Both are uniquely identifiable
# and carry per-test counts, so the runners can show the same `Results:` line E2E
# already shows. The lowercase words never match pytest's per-test `PASSED` lines.
# `Tests` is mandatory-plural so it never matches vitest's separate
# `Test Files  3 passed` line, which would double-count against `Tests  35 passed`.
_PYTEST_SUMMARY_RE = re.compile(r"^=+ .*\bin\s+[\d.]+s.*=+\s*$")
_VITEST_SUMMARY_RE = re.compile(r"^\s*Tests\s+.*\b(?:passed|failed)\b")
_COUNT_RE = re.compile(r"(\d+)\s+(passed|failed|skipped|errors?)")


def count_test_summary(lines: list[str]) -> tuple[int, int, int]:
    """Sum (passed, failed, skipped) across any pytest/vitest summary lines.

    Returns (0, 0, 0) when no summary line is present (e.g. a collection error),
    so callers can suppress an all-zero `Results:` line. Errors count as failures.
    Pure -- unit-tested in `test_diagnostics.py`.
    """
    passed = failed = skipped = 0
    for line in strip_ansi_lines(lines):
        if not (_PYTEST_SUMMARY_RE.match(line) or _VITEST_SUMMARY_RE.match(line)):
            continue
        for num, kind in _COUNT_RE.findall(line):
            n = int(num)
            if kind == "passed":
                passed += n
            elif kind == "skipped":
                skipped += n
            else:  # failed / error / errors
                failed += n
    return passed, failed, skipped


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
        if not any(re.match(r"^E\s+", l) for l in source) and len(raw_block_lines) > len(
            block_lines
        ):
            source = list(raw_block_lines)
            is_raw_fallback = True
        if len(source) > MAX_PER_BLOCK:
            kept = len(source)
            head = source[: MAX_PER_BLOCK - TAIL_PER_BLOCK]
            tail = source[-TAIL_PER_BLOCK:]
            source = [*head, f"  ... ({kept} lines total, truncated)", *tail]
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

        if re.match(r"^={3,}\s+warnings summary", l):
            # The warnings summary (e.g. PytestWarning about a misapplied
            # @pytest.mark.asyncio) is not a failure; its lines embed a
            # `tests/foo.py:NN` substring that would otherwise survive the
            # first-party-frame keep below and pad the failure block. End the
            # block here so the summary body is dropped as non-actionable noise.
            flush_block()
            in_block = False
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
            if re.match(r"^(FAILED |ERROR |=)", l) and not re.match(
                r"^\s*=+\s+\d+\s+(failed|passed|error)", l
            ):
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
                if (
                    re.match(r"^E\s+", l)
                    or re.search(r"(tests/|app/).*\.py:\d+", l)
                    or re.match(r"^(WARNING|ERROR|CRITICAL)\s+", l)
                ):
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


# ---------------------------------------------------------------------------
# vitest filtering -- the frontend runner streams every passing `✓` test, a
# `RUN`/timing banner, and `stderr|`/`stdout|` capture blocks (React `act(...)`
# warnings, expected `[WARN]` logs from negative-path tests). Generic denoise()
# left all of that in, burying the handful of real failures. Keep only the
# failing files/tests, the `Failed Tests` detail blocks, and the `Tests` summary.
# ---------------------------------------------------------------------------

# Structural lines: a failing-file glyph, failing-test glyph, its reason glyph,
# a `FAIL` detail header, the `Tests` summary, or a separator/banner glyph. Any
# of these also terminates a stderr/stdout capture block in progress. (The glyph
# class also includes the passing-test marks so _VITEST_DROP_RE can drop them.)
_VITEST_MARKER_RE = re.compile(
    r"^\s*(?:[❯×→✓✔]|FAIL\b|PASS\b|RUN\b|Test Files\b|Tests\b|Start at\b|Duration\b|⎯)"  # noqa: RUF001
)
# Per-line noise to always drop: passing-test glyphs, and the run banner / timing
# footer (`RUN` / `Test Files` / `Start at` / `Duration`). The `Tests` summary is
# kept because count_test_summary() reads its per-test counts.
_VITEST_DROP_RE = re.compile(r"^\s*(?:[✓✔]|PASS\b|RUN\b|Test Files\b|Start at\b|Duration\b)")
_VITEST_CAPTURE_RE = re.compile(r"^\s*(?:stderr|stdout) \|")


def filter_vitest_output(lines: list[str]) -> list[str]:
    """Keep only actionable vitest lines; drop passing tests and capture blocks.

    Falls back to `denoise` when filtering would strip everything, so the agent
    always has something to act on. Pure -- unit-tested in `test_diagnostics.py`.
    """
    out: list[str] = []
    skipping = False  # inside a stderr/stdout capture block (act/[WARN] noise)
    for l in denoise(lines):
        if _VITEST_CAPTURE_RE.match(l):
            skipping = True
            continue
        if _VITEST_MARKER_RE.match(l):
            skipping = False
            if _VITEST_DROP_RE.match(l):
                continue
            out.append(l)
            continue
        if skipping:
            continue
        out.append(l)
    return out or denoise(lines)


# (report name, section header, parser, fix hint). pytest-format runners reuse
# filter_pytest_output; the vitest frontend runner uses filter_vitest_output.
TEST_SECTIONS = [
    ("pytest", "pytest", filter_pytest_output, "pytest tests/unit/ <path::to::failing_test>"),
    ("hook-tests", "hook-tests", filter_pytest_output, "pytest scripts/hooks/tests"),
    (
        "frontend-tests",
        "frontend-tests",
        filter_vitest_output,
        "npm --prefix frontend run test:run",
    ),
    (
        "bundle-budgets",
        "bundle-budgets",
        filter_vitest_output,
        "npm --prefix frontend run test:bundle",
    ),
    (
        "webhook-e2e",
        "webhook-e2e",
        filter_pytest_output,
        "docker compose exec -T app pytest tests/integration/test_webhook_e2e.py -v",
    ),
    (
        "telnyx-sandbox",
        "telnyx-sandbox",
        filter_pytest_output,
        "TELNYX_SANDBOX=1 pytest tests/integration/test_telnyx_sandbox.py -v --tb=short",
    ),
    (
        "telnyx-chargeable",
        "telnyx-chargeable",
        filter_pytest_output,
        "TELNYX_SANDBOX=1 pytest tests/integration/test_telnyx_sandbox.py -m chargeable -v",
    ),
    (
        "live-e2e",
        "live-e2e",
        filter_pytest_output,
        "python scripts/run-tests.py --target live-e2e",
    ),
]

# Frontend (vitest) tests need Node + a DOM shim (happy-dom) to run, so they can
# only be verified where the frontend toolchain exists. The CI runner splits them
# into their own artifact (logs/frontend-test-failures.log) via `include=` so the
# vitest failures are separable from the backend (pytest-format) targets, which
# stay in logs/test-failures.log. Local runs fold every section into one artifact.
FRONTEND_TEST_TARGETS = frozenset({"frontend-tests", "bundle-budgets"})
BACKEND_TEST_TARGETS = frozenset(name for name, *_ in TEST_SECTIONS) - FRONTEND_TEST_TARGETS


# How much of a skipped target's captured output the artifact keeps. The output is
# an environment error (`No such container`, a refused connection), not a test
# failure, so a handful of lines names the cause; the cap keeps a runaway stack
# trace from burying the failures of the targets that DID run.
_SKIP_BODY_MAX = 30


def _skip_body(lines: list[str]) -> list[str]:
    """The captured output to record for a target that never ran. Pure."""
    body = last_resort(lines)
    if not body:
        return ["(the target produced no output at all)"]
    if len(body) <= _SKIP_BODY_MAX:
        return body
    kept = _SKIP_BODY_MAX - 1
    return [*body[:kept], f"... ({len(body) - kept} more line(s) suppressed)"]


def digest_tests(
    results: dict[str, tuple[list[str], int]],
    source_label: str,
    include: frozenset[str] | set[str] | None = None,
):
    """Build a test-failures artifact from in-memory per-source results.

    Returns `(any_failed, artifact_text, skips)`. A source absent from `results`
    is treated as a clean pass. When `include` is given, only those section names
    are considered (the rest are ignored) -- this is how the CI runner writes
    backend failures and frontend failures to separate artifacts from one results
    dict. `include=None` (the default) folds every section into one artifact.

    A target skipped for an environmental reason is reported in `skips` AND recorded
    in the artifact as a `DID NOT RUN` section carrying its captured output, so the
    file never says "clean" about a suite that never started. It still does not set
    `any_failed`: whether a skip fails the run is the caller's call.
    """
    sections: list[str] = []
    skip_sections: list[str] = []
    skips: list[tuple[str, str]] = []
    any_failed = False

    for name, header, parser, fix_hint in TEST_SECTIONS:
        if include is not None and name not in include:
            continue
        lines, code = results.get(name, ([], 0))
        if code == 0:
            continue
        lines = strip_ansi_lines(lines)
        # Environmental skips only apply when the suite never ran. If a test
        # summary is present, tests executed and the failures are code errors --
        # a skip pattern (e.g. ModuleNotFoundError) appearing inside a failing
        # test's traceback must not swallow the whole target as "skipped".
        skip = get_skip_reason(lines)
        if skip and not any(count_test_summary(lines)):
            skips.append((name, skip))
            # A skip stays out of `any_failed` -- the runner decides that from
            # `_CRITICAL_TARGETS`. It does NOT stay out of the artifact: an empty
            # `logs/test-failures.log` is how this project spells "clean", so a run
            # whose suite never started used to leave behind a file that reads as a
            # green pass and carries nothing to diagnose from.
            skip_sections.append(f"# {header} -- DID NOT RUN ({skip})")
            skip_sections.append(f"# fix: {fix_hint}")
            skip_sections.extend(_skip_body(lines))
            skip_sections.append("")
            continue
        any_failed = True
        body = parser(lines)
        sections.append(f"# {header}")
        sections.append(f"# fix: {fix_hint}")
        sections.extend(
            body
            if body
            else [
                "(exit code indicated failure but no parseable lines -- re-run the runner manually)"
            ]
        )
        sections.append("")

    artifact_body = [*sections, *skip_sections]
    text = "\n".join([source_header(source_label), "", *artifact_body]) if artifact_body else ""
    return any_failed, text, skips


# ---------------------------------------------------------------------------
# E2E helpers -- emit the dedicated `logs/e2e-failures.log` diagnostic artifact,
# with filtering centralized here so runner scripts do not drift independently.
# ---------------------------------------------------------------------------


def get_e2e_fix_hint(blob: str) -> str:
    """Infer a specific fix hint from an E2E failure block's error text."""
    checks = [
        (
            r"CORS policy|Access-Control-Allow-Origin",
            "CORS misconfiguration -- ensure Access-Control-Allow-Origin is not wildcard '*' "
            "when credentials mode is 'include'",
        ),
        (
            r"status[=\s]+5\d\d|Internal Server Error|502|503",
            "backend endpoint returning 5xx -- check the route handler and server logs",
        ),
        (
            r"status[=\s]+4\d\d|Not Found|Forbidden|Unauthorized",
            "backend endpoint returning 4xx -- check auth, route registration, and request payload",
        ),
        (
            r"Timeout|TimeoutError|waiting for selector|waiting for navigation",
            "page element or navigation timed out -- check that the app renders the expected DOM",
        ),
        (
            r"net::ERR_CONNECTION_REFUSED|ECONNREFUSED|net::ERR_EMPTY_RESPONSE|socket hang up",
            "server not reachable -- ensure the backend and frontend dev servers are running "
            "before running E2E tests",
        ),
        (
            r"ElementNotFound|ElementHandle|locator\.",
            "DOM element not found -- check selectors against the current page markup",
        ),
    ]
    for pattern, hint in checks:
        if re.search(pattern, blob):
            return hint
    return "read the test to understand intent, then fix the underlying application code"


def _truncate_e2e_line(line: str, limit: int = 300) -> str:
    return line[:297] + "..." if len(line) > limit else line


def remove_e2e_diff_noise(block: list[str]) -> list[str]:
    """Strip pytest diff noise, keeping file:line context + the first assertion."""
    cleaned: list[str] = []
    hit_assertion = False
    for line in block:
        if re.match(r"^\S.*:\d+:", line) or (
            re.match(r"^\s{4}\S", line) and not line.startswith("E ")
        ):
            cleaned.append(line)
            continue
        if not hit_assertion and re.match(r"^E\s+(Assertion|assert|\+\s+where|.*Error:)", line):
            cleaned.append(_truncate_e2e_line(line))
            hit_assertion = True
            continue
        if hit_assertion and re.match(r"^E\s+\+\s+where", line):
            cleaned.append(_truncate_e2e_line(line))
            continue
        if hit_assertion and re.match(r"^E\s", line):
            continue
        if line.startswith("E ") and not hit_assertion:
            cleaned.append(_truncate_e2e_line(line))
    return cleaned


def build_e2e_artifact(lines: list[str], exit_code: int, fail_count: int) -> str:
    """Build the structured E2E failure artifact. Empty string means clear it."""
    if exit_code == 0:
        return ""

    lines = strip_ansi_lines(lines)
    block_header_re = re.compile(r"^_{3,}\s+(.+?)\s+_{3,}$")

    if fail_count > 0:
        sections: list[str] = []
        current_test = ""
        current_lines: list[str] = []
        in_block = False

        def flush() -> None:
            if current_test and current_lines:
                sections.append(f"# {current_test}")
                sections.append(f"# fix: {get_e2e_fix_hint(chr(10).join(current_lines))}")
                sections.extend(remove_e2e_diff_noise(current_lines))
                sections.append("")

        for line in lines:
            header = block_header_re.match(line)
            if header:
                flush()
                current_test = header.group(1)
                current_lines = []
                in_block = True
                continue
            if in_block and re.match(r"^={3,}\s+(short test summary|warnings summary)", line):
                in_block = False
                continue
            if in_block and line.strip():
                if re.match(r"^(FAILED|={3,}|\.venv|--\s+Docs:)", line):
                    continue
                current_lines.append(line)
        flush()

        summary = [line for line in lines if re.match(r"^FAILED\s+", line)]
        if summary:
            sections += ["# summary", *summary, ""]

        if sections:
            return "\n".join(sections) + "\n"

    filtered = [
        line
        for line in denoise(lines)
        if not re.match(r"^\.venv", line) and not re.match(r"^--\s+Docs:", line)
    ]
    head = [
        "# e2e-collection-error",
        "# fix: check that all test imports resolve and fixtures are available",
    ]
    return "\n".join(head + filtered) + "\n"
