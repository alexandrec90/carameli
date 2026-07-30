"""Tests for scripts/lint-instructions.py — the deterministic instruction-file linter.

Loaded via the hyphen-safe load_module() helper (conftest.py). All checks are pure or
take a tmp_path repo, so no real repo state is touched.
"""

from conftest import load_module

lint = load_module("scripts/lint-instructions.py")


# ------------------------------------------------------------------ frontmatter


def test_parse_frontmatter_scalar_and_list():
    fm = lint.parse_frontmatter("---\ndescription: hi\npaths:\n  - a/**\n  - b/**\n---\nbody")
    assert fm == {"description": "hi", "paths": ["a/**", "b/**"]}


def test_parse_frontmatter_none_when_absent():
    assert lint.parse_frontmatter("# Just a heading\n") is None


def test_rule_requires_description_and_paths():
    rel = ".claude/rules/foo.md"
    good = "---\ndescription: x\npaths:\n  - app/**\n---\n"
    assert lint.check_frontmatter(rel, good) == []

    no_desc = "---\npaths:\n  - app/**\n---\n"
    checks = [f.message for f in lint.check_frontmatter(rel, no_desc)]
    assert any("description" in m for m in checks)

    no_paths = "---\ndescription: x\n---\n"
    checks = [f.message for f in lint.check_frontmatter(rel, no_paths)]
    assert any("paths" in m for m in checks)


def test_a_rule_that_declares_itself_global_may_omit_paths():
    """`authoring.md` permits omitting `paths` for a truly global rule.

    The check's own message said so while still failing every such file, so the one
    genuinely global rule in the vendored tier (`engineering.md`) could not satisfy
    it — and being vendored, it cannot be edited to add paths.
    """
    rel = ".claude/rules/engineering.md"
    declared = (
        "---\ndescription: baseline policy\n---\n\n# Rule: Baseline\n\n"
        "Deliberately **unscoped** (no `paths:`) — these hold everywhere.\n"
    )
    assert lint.check_frontmatter(rel, declared) == []


def test_the_global_escape_hatch_only_applies_near_the_top():
    """A passing mention far down must not exempt a rule that forgot its paths."""
    buried = "---\ndescription: x\n---\n" + "filler\n" * 40 + "this rule is unscoped\n"
    msgs = [f.message for f in lint.check_frontmatter(".claude/rules/foo.md", buried)]
    assert any("paths" in m for m in msgs)


def test_declares_global_scope_unit():
    assert lint._declares_global_scope("---\nd: x\n---\nDeliberately unscoped.\n") is True
    assert lint._declares_global_scope("---\nd: x\n---\nA truly global rule.\n") is True
    assert lint._declares_global_scope("---\nd: x\n---\nOrdinary prose.\n") is False


def test_skill_requires_disable_model_invocation():
    rel = ".claude/skills/foo/SKILL.md"
    good = "---\nname: foo\ndescription: d\ndisable-model-invocation: true\n---\n"
    assert lint.check_frontmatter(rel, good) == []

    missing = "---\nname: foo\ndescription: d\n---\n"
    msgs = [f.message for f in lint.check_frontmatter(rel, missing)]
    assert any("disable-model-invocation" in m for m in msgs)


def test_orchestrated_subskill_may_omit_flag_with_comment():
    # Orchestrated sub-skills (invoked by another skill via the Skill tool) must omit
    # the flag; the documented `# No disable-model-invocation` comment exempts them.
    rel = ".claude/skills/fix-lint/SKILL.md"
    exempt = (
        "---\n"
        "name: fix-lint\n"
        "# No disable-model-invocation: invoked programmatically by /fix-all via the Skill tool.\n"
        "description: d\n"
        "---\n"
    )
    assert lint.check_frontmatter(rel, exempt) == []


def test_claude_md_needs_no_frontmatter():
    assert lint.check_frontmatter("CLAUDE.md", "# Project\nno frontmatter here\n") == []


# ------------------------------------------------------------------------- size


def test_size_caps():
    big_claude = "\n".join(["x"] * (lint.CLAUDE_MAX_LINES + 5))
    assert lint.check_size("CLAUDE.md", big_claude)
    assert lint.check_size("CLAUDE.md", "short\n") == []

    big_skill = "\n".join(["x"] * (lint.SKILL_MAX_LINES + 5))
    assert lint.check_size(".claude/skills/foo/SKILL.md", big_skill)


# ------------------------------------------------------------------------ links


def test_dead_and_live_links(tmp_path):
    (tmp_path / "real.md").write_text("hi")
    f = tmp_path / "doc.md"
    f.write_text("See [ok](real.md) and [bad](nope.md).")
    msgs = [x.message for x in lint.check_links(f, f.read_text(), tmp_path)]
    assert any("nope.md" in m for m in msgs)
    assert not any("real.md" in m for m in msgs)


def test_regex_in_parens_is_not_a_link(tmp_path):
    f = tmp_path / "doc.md"
    # A grep regex that happens to sit inside ](...) must not be treated as a file link.
    f.write_text(r'Grep for `os\.(getenv)\(["' "'" "](.*key.*|.*secret.*)`")
    assert lint.check_links(f, f.read_text(), tmp_path) == []


# -------------------------------------------------------------------- structure


def test_fixer_without_known_fixes_is_flagged(tmp_path):
    d = tmp_path / ".claude" / "skills" / "fix-thing"
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text("---\nname: fix-thing\n---\n")
    msgs = [
        f.message for f in lint.check_skill_structure(d, "---\nname: fix-thing\n---\n", tmp_path)
    ]
    assert any("known-fixes.md" in m for m in msgs)


def test_fixer_with_known_fixes_passes(tmp_path):
    d = tmp_path / ".claude" / "skills" / "fix-thing"
    d.mkdir(parents=True)
    (d / "known-fixes.md").write_text("| a |\n|---|\n")
    text = "---\nname: fix-thing\n---\n"
    assert lint.check_skill_structure(d, text, tmp_path) == []


def test_exempt_fixer_needs_no_known_fixes(tmp_path):
    d = tmp_path / ".claude" / "skills" / "fix-all"
    d.mkdir(parents=True)
    text = "---\nname: fix-all\n---\n"
    assert lint.check_skill_structure(d, text, tmp_path) == []


def test_non_fixer_skill_needs_no_known_fixes(tmp_path):
    d = tmp_path / ".claude" / "skills" / "optimize-fixers"
    d.mkdir(parents=True)
    text = "---\nname: optimize-fixers\n---\nreads each known-fixes.md\n"
    assert lint.check_skill_structure(d, text, tmp_path) == []


def test_name_dir_mismatch_flagged(tmp_path):
    d = tmp_path / ".claude" / "skills" / "foo"
    d.mkdir(parents=True)
    text = "---\nname: bar\ndisable-model-invocation: true\n---\n"
    msgs = [f.message for f in lint.check_skill_structure(d, text, tmp_path)]
    assert any("!= directory" in m for m in msgs)


def test_known_fixes_table_separator_required():
    assert lint.check_known_fixes_table("x/known-fixes.md", "| a | b |\n|---|---|\n") == []
    assert lint.check_known_fixes_table("x/known-fixes.md", "no table here\n")
