#!/usr/bin/env python3
"""Scaffold a promptfoo eval task from a real `error -> fix commit -> outcome` triple.

Plan 4 of the fixer feedback loop (see `plans/fixer-feedback-loop/`). Given a
triage-flagged error signature, its owning `fix-*` skill, and the `last_commit`
SHA of the fix attempt, this turns the *pre-fix* (broken) state of the changed
source file into a committed-style destructive eval task under `evals/tasks/`,
so the eval suite is seeded from production failures instead of hand-picked
fixtures.

The Goodhart guardrail (see the plan) is enforced here, not just in the driving
skill:

- It **only scaffolds** — it never runs `optimize-fixers` or edits a `fix-*`
  skill. Generation and optimization stay in separate hands.
- Every generated task is a **proposal**: `metadata.generated: true` plus a
  comment citing the source commit, so a future optimize loop can be told to
  exclude generated fixtures from "optimize against" decisions. The caller is
  responsible for the human review gate — this script writes files but never
  commits them.
- It refuses to mint when the triple isn't a real, single-file *code* fix:
  the commit must exist, touch source (not just logs/docs), be a one-source-file
  change with a derivable pre-fix state, produce a discriminating diff, and the
  error signature must be a code error (not an environment/tool-missing flake)
  per `.claude/rules/diagnostics.md`. Otherwise it skips with a reason.

The pure functions (classification, diff parsing, scaffold rendering) are
importable and unit-tested in `scripts/hooks/tests/test_gen_eval_fixture.py`;
only `main()` touches git and the filesystem.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

# fix-* skill -> the log artifact it diagnoses from (the contract in
# `.claude/rules/diagnostics.md` section 8, plus the fix-logs / fix-e2e runners).
ARTIFACT_BY_SKILL = {
    "fix-tests": "logs/test-failures.log",
    "fix-lint": "logs/lint-errors.log",
    "fix-pre-commit": "logs/pre-commit-errors.log",
    "fix-logs": "logs/log-errors.log",
    "fix-docker": "logs/docker/health.log",
    "fix-e2e": "logs/e2e-failures.log",
}

# Substrings that mark a NON-code (environment / tool-missing) failure per
# `.claude/rules/diagnostics.md` section 3. These can't be repaired by editing
# source, so they must never be minted into a fixture. Kept to unambiguous
# markers — ambiguous ones (e.g. "no module named") are left as code so the
# stronger source-touch guardrail decides.
_NON_CODE_MARKERS: list[tuple[str, str]] = [
    ("connection refused", "environment"),
    ("econnrefused", "environment"),
    ("could not connect", "environment"),
    ("could not translate host", "environment"),
    ("connection reset", "environment"),
    ("timed out", "environment"),
    ("timeout", "environment"),
    ("authentication failed", "environment"),
    ("address already in use", "environment"),
    ("no such host", "environment"),
    ("service unavailable", "environment"),
    ("command not found", "tool-missing"),
    ("executable not found", "tool-missing"),
    ("not installed", "tool-missing"),
]

# A removed/added diff line shorter than this (after stripping) is too generic to
# assert on (braces, blank lines, bare keywords), so it's dropped.
_MIN_DISTINCTIVE_LEN = 4
# Cap how many include/exclude lines the generated verify asserts on.
_MAX_ASSERT_LINES = 3
# Above this many raw changed lines (or >1 hunk) the bug likely needs reasoning,
# so the task opts into the Sonnet-tier "capable" providers.
_CAPABLE_CHANGED_LINES = 6

CHEAP_PROVIDERS = ["with-instructions", "baseline-no-instructions"]
CAPABLE_PROVIDERS = ["with-instructions-capable", "baseline-capable"]


class Skip:
    """The triple can't be safely minted; `reason` is reported to the caller."""

    def __init__(self, reason: str) -> None:
        self.reason = reason


class Scaffold:
    """A ready-to-write eval task. `files` maps forward-slash repo-relative paths
    to file contents."""

    def __init__(
        self,
        task_name: str,
        target_source_path: str,
        source_commit: str,
        providers: list[str],
        files: dict[str, str],
    ) -> None:
        self.task_name = task_name
        self.target_source_path = target_source_path
        self.source_commit = source_commit
        self.providers = providers
        self.files = files


# --------------------------------------------------------------------------- #
# Pure classification / parsing helpers
# --------------------------------------------------------------------------- #
def classify_signature(signature: str) -> tuple[str, str]:
    """Return (class, marker). class is 'code', 'environment', or 'tool-missing'.

    Anything not matching a known environment/tool-missing marker is treated as a
    code error (the source-touch check is the second line of defence)."""
    low = signature.lower()
    for marker, klass in _NON_CODE_MARKERS:
        if marker in low:
            return klass, marker
    return "code", ""


def is_source_path(path: str) -> bool:
    """A changed path counts as source unless it's a log or doc artifact."""
    p = path.replace("\\", "/").lower()
    if p.startswith("logs/"):
        return False
    return not p.endswith((".log", ".md", ".txt"))


def parse_name_status(text: str) -> list[tuple[str, str]]:
    """Parse `git show --name-status --format=` into [(status, path), ...].

    Renames/copies (R###/C###) carry old+new tab-separated; the new path is used.
    Only the leading status letter is kept (M/A/D/R/C)."""
    out: list[tuple[str, str]] = []
    for line in text.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        status = parts[0]
        path = parts[2] if status[:1] in ("R", "C") and len(parts) >= 3 else parts[-1]
        out.append((status[:1], path))
    return out


def parse_unified_diff(diff_text: str) -> dict[str, dict[str, list[str]]]:
    """Parse a unified diff into {path: {"added": [...], "removed": [...]}}.

    Lines are captured verbatim (without the leading +/-). The post-image path
    from `+++ b/<path>` keys the result; a deletion (`+++ /dev/null`) is ignored."""
    files: dict[str, dict[str, list[str]]] = {}
    cur: str | None = None
    for line in diff_text.splitlines():
        if line.startswith("+++ "):
            target = line[4:].strip()
            if target == "/dev/null":
                cur = None
            else:
                cur = target[2:] if target.startswith(("a/", "b/")) else target
                files.setdefault(cur, {"added": [], "removed": []})
            continue
        if line.startswith("--- ") or line.startswith("diff ") or line.startswith("@@"):
            continue
        if cur is None:
            continue
        if line.startswith("+"):
            files[cur]["added"].append(line[1:])
        elif line.startswith("-"):
            files[cur]["removed"].append(line[1:])
    return files


def _is_trivial(s: str) -> bool:
    """A diff line too generic to assert on: short, a comment divider, or a lone
    bracket/keyword. Dividers (`# -----`) and braces carry no signal and would make
    a brittle or impossible assertion, so they're dropped before picking lines."""
    if len(s) < _MIN_DISTINCTIVE_LEN:
        return True
    body = s.lstrip("#/ \t").strip()  # strip a leading comment marker
    alnum = sum(c.isalnum() for c in body)
    return alnum < 3


def _distinctive(lines: list[str], limit: int = _MAX_ASSERT_LINES) -> list[str]:
    """Stripped, deduped, non-trivial lines suitable as substring assertions."""
    out: list[str] = []
    for raw in lines:
        s = raw.strip()
        if _is_trivial(s) or s in out:
            continue
        out.append(s)
        if len(out) >= limit:
            break
    return out


def discriminating_lines(
    added: list[str], removed: list[str], limit: int = _MAX_ASSERT_LINES
) -> tuple[list[str], list[str]]:
    """Pick the include (added) / exclude (removed) substrings the verify asserts.

    Removed lines that still appear inside an added line are dropped — they could
    never be excluded after the repair."""
    add = _distinctive(added, limit)
    rem = _distinctive(removed, limit)
    rem = [r for r in rem if not any(r in a for a in add)]
    return add, rem


def artifact_for_skill(skill: str) -> str | None:
    return ARTIFACT_BY_SKILL.get(skill)


def derive_task_name(skill: str, signature: str, commit: str) -> str:
    """Stable, filesystem-safe task name tying the fixture to its source commit."""
    sig4 = hashlib.sha1(signature.encode("utf-8"), usedforsecurity=False).hexdigest()[:4]
    return f"gen-{skill}-{commit[:7]}-{sig4}"


def select_source_file(
    name_status: list[tuple[str, str]],
) -> tuple[str | None, str | None]:
    """Pick the single changed source file, or return (None, skip_reason).

    Logs/docs are ignored. Multi-source-file fixes are skipped (ambiguous broken
    state); a fix that only added/deleted the source file has no derivable pre-fix
    state and is also skipped."""
    sources = [(st, p) for (st, p) in name_status if is_source_path(p)]
    if not sources:
        return None, "fix commit touched no source files (logs/docs only)"
    if len(sources) > 1:
        paths = ", ".join(p for _, p in sources)
        return (
            None,
            f"fix touched multiple source files ({paths}); cannot auto-mint a single broken fixture",
        )
    status, path = sources[0]
    if status == "A":
        return (
            None,
            f"source file {path} was added in the fix commit; no pre-fix (broken) state to derive",
        )
    if status == "D":
        return None, f"source file {path} was deleted by the fix; cannot build a fix-by-edit task"
    return path, None


# --------------------------------------------------------------------------- #
# Pure rendering helpers
# --------------------------------------------------------------------------- #
def _js_template_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")


def _yaml_squote(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"


def render_seed_log(
    skill: str, signature: str, fixture_path: str, source_path: str, commit: str
) -> str:
    """The log artifact content seeded before the agent runs. The source path is
    remapped to the fixture path so the agent edits the committed broken fixture,
    not the (unbroken) real source."""
    remapped = signature.replace(source_path, fixture_path)
    return (
        f"# source: scripts/gen-eval-fixture.py (generated from {commit})\n"
        f"# fix: repair the bug in {fixture_path}\n"
        f"{remapped}\n"
    )


def render_setup_cjs(skill: str, artifact: str, seed_log: str, commit: str) -> str:
    return (
        "/**\n"
        f" * GENERATED by scripts/gen-eval-fixture.py from commit {commit}.\n"
        " * PROPOSAL — review before committing. Seeds the fixer's log artifact with\n"
        " * the real error signature (remapped to the committed broken fixture so the\n"
        f" * /{skill} skill edits the fixture, not the unbroken real source).\n"
        " */\n"
        "const { writeLog } = require('../../lib/fixture.cjs');\n"
        "\n"
        f"const LOG = `{_js_template_escape(seed_log)}`;\n"
        "\n"
        "module.exports = function setup(worktree) {\n"
        f"  writeLog(worktree, '{artifact}', LOG);\n"
        "};\n"
    )


def render_verify_cjs(
    fixture_path: str, includes: list[str], excludes: list[str], commit: str
) -> str:
    inc = json.dumps(includes, ensure_ascii=False)
    exc = json.dumps(excludes, ensure_ascii=False)
    return (
        "/**\n"
        f" * GENERATED by scripts/gen-eval-fixture.py from commit {commit}.\n"
        " * Content check derived from that commit's diff: the broken lines the real\n"
        " * fix removed must be gone, and the lines it added must be present. Confirm\n"
        " * this actually discriminates (npm run eval:ablate) before trusting it.\n"
        " */\n"
        "const { fixtureMatches } = require('../../lib/fixture.cjs');\n"
        "\n"
        "module.exports = function verify(worktree) {\n"
        f"  return fixtureMatches(worktree, '{fixture_path}', {{\n"
        f"    includes: {inc},\n"
        f"    excludes: {exc},\n"
        "  });\n"
        "};\n"
    )


def render_test_yaml(
    skill: str,
    task_name: str,
    signature: str,
    artifact: str,
    providers: list[str],
    commit: str,
) -> str:
    providers_inline = "[" + ", ".join(providers) + "]"
    baseline = (
        f"A failure for /{skill} is recorded in {artifact}. Read that log, open the "
        "file it names, and fix the bug with the smallest edit."
    )
    return (
        "# GENERATED by scripts/gen-eval-fixture.py — PROPOSAL, review before committing.\n"
        f"# Source: commit {commit} — a real fix attempt for /{skill} on signature:\n"
        f"#   {signature}\n"
        f"# setup.cjs seeds {artifact} with the broken state, the agent runs /{skill},\n"
        "# and verify.cjs checks the repair (diff-derived content check).\n"
        "#\n"
        "# Goodhart guardrail: this is a GENERATED regression guard (metadata.generated:\n"
        "# true). Do NOT let optimize-fixers tune a skill against it — exclude generated\n"
        "# fixtures from any 'optimize against' decision, or the skill overfits to it.\n"
        "\n"
        "- metadata:\n"
        "    targets:\n"
        f"      - .claude/skills/{skill}\n"
        "    generated: true\n"
        f"    source_commit: {_yaml_squote(commit)}\n"
        f"    source_signature: {_yaml_squote(signature)}\n"
        f"  providers: {providers_inline}\n"
        "  vars:\n"
        f"    prompt: /{skill}\n"
        "    baselinePrompt: >-\n"
        f"      {baseline}\n"
        f"    setup: tasks/{task_name}/setup.cjs\n"
        f"    verify: tasks/{task_name}/verify.cjs\n"
        "  threshold: 0.7\n"
        "  assert:\n"
        "    - type: javascript\n"
        "      value: context.providerResponse?.metadata?.verifyPassed === true\n"
        "      weight: 3\n"
        "    - type: javascript\n"
        "      value: context.providerResponse?.metadata?.madeAnEdit === true\n"
        "      weight: 1\n"
        "    - type: javascript\n"
        "      value: '(context.providerResponse?.metadata?.readsBeforeFirstEdit ?? 99) <= 6'\n"
        "      weight: 1\n"
    )


def choose_providers(changed_line_count: int, hunk_count: int) -> list[str]:
    if hunk_count > 1 or changed_line_count > _CAPABLE_CHANGED_LINES:
        return list(CAPABLE_PROVIDERS)
    return list(CHEAP_PROVIDERS)


# --------------------------------------------------------------------------- #
# Pure orchestrator
# --------------------------------------------------------------------------- #
def build_scaffold(
    *,
    skill: str,
    signature: str,
    commit: str,
    name_status: list[tuple[str, str]],
    diff_text: str,
    pre_fix_contents: dict[str, str],
) -> Skip | Scaffold:
    """Decide whether the triple can be minted, and if so render the task files.

    Everything is plain data so this is unit-testable without git: `name_status`
    and `diff_text` are `git show` outputs; `pre_fix_contents` maps source paths
    to their pre-fix (`<commit>^:path`) content."""
    artifact = artifact_for_skill(skill)
    if artifact is None:
        return Skip(f"unknown fixer skill '{skill}': no known log artifact to seed")

    klass, marker = classify_signature(signature)
    if klass != "code":
        return Skip(
            f"signature looks like a {klass} error (matched '{marker}'), not a code "
            "error — likely an environment flake, not a fixable bug"
        )

    target, reason = select_source_file(name_status)
    if target is None:
        return Skip(reason or "no eligible source file")

    if target not in pre_fix_contents:
        return Skip(f"could not read pre-fix state of {target} (file added or commit squashed)")

    diff = parse_unified_diff(diff_text)
    file_diff = diff.get(target, {"added": [], "removed": []})
    hunk_count = sum(1 for line in diff_text.splitlines() if line.startswith("@@"))
    includes, excludes = discriminating_lines(file_diff["added"], file_diff["removed"])
    if not includes and not excludes:
        return Skip(
            f"diff for {target} has no distinctive lines to assert on — the "
            "generated task could not discriminate fixed from broken"
        )

    task_name = derive_task_name(skill, signature, commit)
    basename = target.replace("\\", "/").split("/")[-1]
    fixture_path = f"evals/fixtures/{task_name}/{basename}"

    seed_log = render_seed_log(skill, signature, fixture_path, target, commit)
    providers = choose_providers(len(file_diff["added"]) + len(file_diff["removed"]), hunk_count)

    files = {
        fixture_path: pre_fix_contents[target],
        f"evals/tasks/{task_name}/setup.cjs": render_setup_cjs(skill, artifact, seed_log, commit),
        f"evals/tasks/{task_name}/verify.cjs": render_verify_cjs(
            fixture_path, includes, excludes, commit
        ),
        f"evals/tasks/{task_name}/test.yaml": render_test_yaml(
            skill, task_name, signature, artifact, providers, commit
        ),
    }
    return Scaffold(
        task_name=task_name,
        target_source_path=target,
        source_commit=commit,
        providers=providers,
        files=files,
    )


# --------------------------------------------------------------------------- #
# git wiring (impure — exercised by main(), not the unit tests)
# --------------------------------------------------------------------------- #
def _git(args: list[str], root: Path) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=str(root),
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"git {' '.join(args)} failed")
    return result.stdout


def commit_exists(commit: str, root: Path) -> bool:
    result = subprocess.run(
        ["git", "rev-parse", "--verify", "--quiet", f"{commit}^{{commit}}"],
        cwd=str(root),
        capture_output=True,
        text=True,
    )
    return result.returncode == 0


def gather_git_inputs(commit: str, root: Path) -> tuple[list[tuple[str, str]], str, dict[str, str]]:
    """Return (name_status, diff_text, pre_fix_contents) for the fix commit."""
    name_status = parse_name_status(_git(["show", "--name-status", "--format=", commit], root))
    diff_text = _git(["show", "--format=", "--unified=3", commit], root)
    pre_fix: dict[str, str] = {}
    for _status, path in name_status:
        if not is_source_path(path):
            continue
        try:
            pre_fix[path] = _git(["show", f"{commit}^:{path}"], root)
        except RuntimeError:
            continue  # file added in this commit -> no parent version
    return name_status, diff_text, pre_fix


def write_scaffold(scaffold: Scaffold, root: Path) -> list[Path]:
    written: list[Path] = []
    for rel, content in scaffold.files.items():
        dest = root / Path(rel)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(content, encoding="utf-8", newline="\n")
        written.append(dest)
    return written


def validate_scaffold(paths: list[Path]) -> list[str]:
    """Best-effort parse check (YAML loads, cjs `node --check`). Returns warnings
    for any check that couldn't run; raises on an actual parse failure."""
    warnings: list[str] = []
    try:
        import yaml  # type: ignore
    except ImportError:
        yaml = None
        warnings.append("PyYAML not installed — skipped YAML validation")
    for p in paths:
        if p.suffix == ".yaml" and yaml is not None:
            yaml.safe_load(p.read_text(encoding="utf-8"))
        elif p.suffix == ".cjs":
            result = subprocess.run(["node", "--check", str(p)], capture_output=True, text=True)
            if result.returncode != 0:
                if "not found" in result.stderr.lower() or result.returncode == 127:
                    warnings.append(f"node not available — skipped check of {p.name}")
                else:
                    raise RuntimeError(f"node --check failed for {p}:\n{result.stderr}")
    return warnings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skill", required=True, help="owning fix-* skill, e.g. fix-tests")
    parser.add_argument("--signature", required=True, help="the error signature from the ledger")
    parser.add_argument("--commit", required=True, help="last_commit SHA of the fix attempt")
    parser.add_argument("--repo-root", default=str(REPO_ROOT))
    parser.add_argument(
        "--dry-run", action="store_true", help="report the plan without writing files"
    )
    args = parser.parse_args(argv)
    root = Path(args.repo_root).resolve()

    if not commit_exists(args.commit, root):
        print(f"SKIP: commit {args.commit} not found in this repository.")
        return 2

    try:
        name_status, diff_text, pre_fix = gather_git_inputs(args.commit, root)
    except RuntimeError as exc:
        print(f"SKIP: could not read commit {args.commit}: {exc}")
        return 2

    result = build_scaffold(
        skill=args.skill,
        signature=args.signature,
        commit=args.commit,
        name_status=name_status,
        diff_text=diff_text,
        pre_fix_contents=pre_fix,
    )
    if isinstance(result, Skip):
        print(f"SKIP: {result.reason}")
        return 2

    print(f"Scaffolding generated eval task: {result.task_name}")
    print(f"  source commit : {result.source_commit}")
    print(f"  broken file   : {result.target_source_path}")
    print(f"  providers     : {', '.join(result.providers)}")
    if args.dry_run:
        print("\n(dry run — no files written)")
        for rel in result.files:
            print(f"  would write: {rel}")
        return 0

    written = write_scaffold(result, root)
    warnings = validate_scaffold(written)
    print("\nWrote:")
    for p in written:
        print(f"  {p.relative_to(root).as_posix()}")
    for w in warnings:
        print(f"  warning: {w}")
    print(
        "\nPROPOSAL — this is a generated regression guard left UNCOMMITTED for human\n"
        "review. Do not merge it into the eval suite, run optimize-fixers, or edit any\n"
        "fix-* skill off it. Confirm it discriminates with:\n"
        f"  npm run eval:ablate -- .claude/skills/{args.skill}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
