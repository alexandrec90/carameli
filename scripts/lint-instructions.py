#!/usr/bin/env python3
"""Deterministic linter for instruction files (CLAUDE.md, .claude/rules, .claude/skills).

The promptfoo harness under `evals/` is the slow, stochastic, paid *integration* layer
for instruction files; this is the fast, free, deterministic *unit* layer. It enforces
the structural contracts in `.claude/rules/authoring.md` that were previously
honor-system, so a malformed instruction file fails on commit instead of silently
degrading the agent (or wasting an eval run):

  - Frontmatter schema  — rules need `description` + `paths`; skills need `name`,
                          `description`, and `disable-model-invocation: true` (unless an
                          orchestrated sub-skill documents the omission — see the check).
  - Dead links / deps   — markdown links to repo files resolve; a SKILL.md that
                          references `known-fixes.md` must have that sibling.
  - Size caps           — CLAUDE.md <= 200 lines, SKILL.md <= 500 (authoring.md).
  - Structure           — skill `name` matches its dir; a fixer that uses the
                          known-fixes short-circuit has a "Hard Rules" section; a
                          known-fixes.md is a well-formed markdown table.

Stdlib only (no extra deps, like the hook scripts).
Pure functions are exposed for pytest (`scripts/hooks/tests/test_lint_instructions.py`);
the __main__ guard walks the repo, prints findings as `path:line: [check] message`, and
exits 1 if any are found.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import NamedTuple

REPO_ROOT = Path(__file__).resolve().parents[1]

CLAUDE_MAX_LINES = 200
SKILL_MAX_LINES = 500

# Fixer skills with no seedable log artifact, so the known-fixes short-circuit does
# not apply (documented in evals/README.md): an aggregate dispatcher and a
# live-diagnostics reader.
FIXER_EXEMPT = {"fix-all", "fix-problems"}

# Directories never walked for instruction files.
SKIP_DIRS = {"node_modules", ".git", ".venv", "dist", "build", "__pycache__"}

LINK_RE = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
FM_KEY_RE = re.compile(r"^([A-Za-z_][\w-]*):\s*(.*)$")


class Finding(NamedTuple):
    path: str  # repo-relative, forward slashes
    line: int
    check: str
    message: str


# --------------------------------------------------------------------------- parsing


def parse_frontmatter(text: str) -> dict | None:
    """Parse a leading `--- ... ---` YAML block into a dict (stdlib-only, minimal).

    Top-level `key: value` becomes a string; a bare `key:` followed by `- item` lines
    becomes a list. Returns None when there is no frontmatter block. Good enough for
    the small, flat frontmatter these files use — not a general YAML parser.
    """
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return None
    fm: dict = {}
    last_key: str | None = None
    for line in lines[1:]:
        if line.strip() == "---":
            break
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        stripped = line.strip()
        if stripped.startswith("- ") and last_key is not None:
            fm.setdefault(last_key, [])
            if isinstance(fm[last_key], list):
                fm[last_key].append(stripped[2:].strip().strip("'\""))
            continue
        if not line.startswith((" ", "\t")):
            m = FM_KEY_RE.match(line)
            if m:
                key, val = m.group(1), m.group(2).strip().strip("'\"")
                last_key = key
                fm[key] = val if val else []
    return fm


def _truthy(val) -> bool:
    return isinstance(val, str) and val.lower() in ("true", "yes", "1")


def _nonempty_str(val) -> bool:
    return isinstance(val, str) and bool(val.strip())


def _nonempty_list(val) -> bool:
    return isinstance(val, list) and len(val) > 0


def _declares_global_scope(text: str) -> bool:
    """True when a rule says in its own body that it is deliberately unscoped.

    `.claude/rules/authoring.md` permits omitting `paths` for a truly global rule, and
    the check's own message said so while still failing every such file — so the one
    genuinely global rule in the vendored tier (`engineering.md`) could not satisfy it.
    That rule is byte-identical upstream and drift-checked, so "just add paths" is not
    available: the fix has to be here.

    The signal is a statement in the opening prose, not a frontmatter key, for the same
    reason as the orchestration exemption below — it has to be readable by someone
    looking at the file, and a rule that claims to be global should say why where a
    human will see it. Checked only near the top so a passing mention of the word
    "unscoped" further down cannot silently exempt a rule that forgot its paths.
    """
    head = "\n".join(text.splitlines()[:20]).lower()
    return "unscoped" in head or "truly global" in head


def _documents_orchestration_exemption(text: str) -> bool:
    """True when a skill's frontmatter justifies omitting `disable-model-invocation`.

    Orchestrated sub-skills (invoked by another skill via the Skill tool) MUST omit
    the flag — it blocks all Skill-tool invocation, including from a parent skill, so
    setting it would break the parent's call (see .claude/rules/authoring.md). The
    convention is to document the omission with a `# No disable-model-invocation`
    comment in the frontmatter block. That comment is what distinguishes an
    intentional exception (e.g. fix-tests, invoked by /fix-all) from an accidental
    omission in a user-only skill that simply forgot the flag.
    """
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return False
    for line in lines[1:]:
        if line.strip() == "---":
            break
        if line.lstrip().startswith("#") and "disable-model-invocation" in line:
            return True
    return False


# ---------------------------------------------------------------------------- checks


def check_frontmatter(rel: str, text: str) -> list[Finding]:
    """Schema for rule and skill frontmatter. CLAUDE.md needs none."""
    out: list[Finding] = []
    rel = rel.replace("\\", "/")
    is_rule = "/.claude/rules/" in f"/{rel}" or rel.startswith(".claude/rules/")
    is_skill = rel.endswith("/SKILL.md") and ".claude/skills/" in rel

    if not (is_rule or is_skill):
        return out

    fm = parse_frontmatter(text)
    if fm is None:
        out.append(Finding(rel, 1, "frontmatter", "missing YAML frontmatter block (--- ... ---)"))
        return out

    if is_rule:
        if not _nonempty_str(fm.get("description")):
            out.append(Finding(rel, 1, "frontmatter", "rule missing non-empty 'description'"))
        if not _nonempty_list(fm.get("paths")) and not _declares_global_scope(text):
            out.append(
                Finding(
                    rel,
                    1,
                    "frontmatter",
                    "rule missing non-empty 'paths' — scope it, or state near the top "
                    "that it is deliberately unscoped/global (see "
                    ".claude/rules/authoring.md)",
                )
            )
    if is_skill:
        if not _nonempty_str(fm.get("name")):
            out.append(Finding(rel, 1, "frontmatter", "skill missing non-empty 'name'"))
        if not _nonempty_str(fm.get("description")):
            out.append(Finding(rel, 1, "frontmatter", "skill missing non-empty 'description'"))
        if not _truthy(
            fm.get("disable-model-invocation")
        ) and not _documents_orchestration_exemption(text):
            out.append(
                Finding(
                    rel,
                    1,
                    "frontmatter",
                    "skill must set 'disable-model-invocation: true' (or, for an "
                    "orchestrated sub-skill invoked via the Skill tool, document the "
                    "omission with a '# No disable-model-invocation' frontmatter comment)",
                )
            )
    return out


def check_size(rel: str, text: str) -> list[Finding]:
    rel = rel.replace("\\", "/")
    n = len(text.splitlines())
    if rel == "CLAUDE.md" or rel.endswith("/CLAUDE.md"):
        if n > CLAUDE_MAX_LINES:
            return [Finding(rel, n, "size", f"CLAUDE.md is {n} lines (cap {CLAUDE_MAX_LINES})")]
    elif rel.endswith("/SKILL.md") and n > SKILL_MAX_LINES:
        return [
            Finding(
                rel,
                n,
                "size",
                f"SKILL.md is {n} lines (cap {SKILL_MAX_LINES}); use progressive disclosure",
            )
        ]
    return []


def check_links(file_path: Path, text: str, repo_root: Path) -> list[Finding]:
    """Markdown links to local files must resolve (relative to the file, then repo root)."""
    rel = file_path.relative_to(repo_root).as_posix()
    out: list[Finding] = []
    for m in LINK_RE.finditer(text):
        target = m.group(1).strip().split()[0] if m.group(1).strip() else ""
        if (
            not target
            or target.startswith(("#", "http://", "https://", "mailto:", "<"))
            or "://" in target
        ):
            continue
        target = target.split("#", 1)[0]  # drop #anchor / #L42
        if not target:
            continue
        # Only treat path-shaped targets as file links — skip regexes/globs/code that
        # happen to sit inside `](...)` (e.g. `](.*key.*|.*secret.*)`).
        if not re.fullmatch(r"[\w./~-]+", target):
            continue
        candidates = [(file_path.parent / target), (repo_root / target)]
        if not any(c.exists() for c in candidates):
            line = text[: m.start()].count("\n") + 1
            out.append(Finding(rel, line, "dead-link", f"link target not found: {target}"))
    return out


def check_skill_structure(skill_dir: Path, text: str, repo_root: Path) -> list[Finding]:
    """Skill structure: frontmatter `name` matches the dir, and a fixer owns known-fixes.md.

    A non-exempt `fix-*` skill must have a sibling `known-fixes.md` (authoring.md). We key
    this off the directory name, not text mentions: meta-skills like optimize-fixers /
    plan-handoff and the exempt fixers legitimately *reference* other skills'
    known-fixes.md without owning one.
    """
    rel = (skill_dir / "SKILL.md").relative_to(repo_root).as_posix()
    out: list[Finding] = []
    name = skill_dir.name

    fm = parse_frontmatter(text) or {}
    if _nonempty_str(fm.get("name")) and fm["name"] != name:
        out.append(
            Finding(rel, 1, "structure", f"frontmatter name '{fm['name']}' != directory '{name}'")
        )

    if (
        name.startswith("fix-")
        and name not in FIXER_EXEMPT
        and not (skill_dir / "known-fixes.md").exists()
    ):
        out.append(
            Finding(
                rel,
                1,
                "structure",
                "fixer skill has no sibling known-fixes.md (authoring.md mandates one); "
                "add it, or add the skill to FIXER_EXEMPT if it has no seedable log",
            )
        )
    return out


def check_known_fixes_table(rel: str, text: str) -> list[Finding]:
    """A known-fixes.md must be a well-formed markdown table (header + separator row)."""
    rel = rel.replace("\\", "/")
    has_sep = any(
        re.match(r"^\s*\|?[\s:|-]*-{3,}[\s:|-]*\|", ln) or re.match(r"^\s*\|[\s:-]+\|", ln)
        for ln in text.splitlines()
    )
    if not has_sep:
        return [Finding(rel, 1, "structure", "known-fixes.md has no markdown table separator row")]
    return []


# -------------------------------------------------------------------------- walking


def lint_file(file_path: Path, repo_root: Path) -> list[Finding]:
    text = file_path.read_text(encoding="utf-8", errors="replace")
    rel = file_path.relative_to(repo_root).as_posix()
    out = (
        check_frontmatter(rel, text)
        + check_size(rel, text)
        + check_links(file_path, text, repo_root)
    )
    if file_path.name == "SKILL.md":
        out += check_skill_structure(file_path.parent, text, repo_root)
    if file_path.name == "known-fixes.md":
        out += check_known_fixes_table(rel, text)
    return out


def instruction_files(repo_root: Path) -> list[Path]:
    """All instruction files to lint: CLAUDE.md (any level), rules, skills + their sibling md."""
    found: list[Path] = []

    def walk_claude(base: Path):
        for p in base.rglob("CLAUDE.md"):
            if not any(part in SKIP_DIRS for part in p.parts):
                found.append(p)

    walk_claude(repo_root)
    rules = repo_root / ".claude" / "rules"
    if rules.is_dir():
        found += sorted(rules.glob("*.md"))
    skills = repo_root / ".claude" / "skills"
    if skills.is_dir():
        for d in sorted(skills.iterdir()):
            if not d.is_dir():
                continue
            if (d / "SKILL.md").exists():
                found.append(d / "SKILL.md")
            if (d / "known-fixes.md").exists():
                found.append(d / "known-fixes.md")
    # de-dup, stable order
    seen, uniq = set(), []
    for p in found:
        if p not in seen:
            seen.add(p)
            uniq.append(p)
    return uniq


def lint_repo(repo_root: Path) -> list[Finding]:
    out: list[Finding] = []
    for f in instruction_files(repo_root):
        out += lint_file(f, repo_root)
    return sorted(out, key=lambda f: (f.path, f.line, f.check))


def main(argv: list[str]) -> int:
    root = REPO_ROOT
    findings = lint_repo(root)
    if not findings:
        print("lint-instructions: OK — all instruction files pass.")
        return 0
    print(f"lint-instructions: {len(findings)} issue(s):\n")
    for f in findings:
        print(f"{f.path}:{f.line}: [{f.check}] {f.message}")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
