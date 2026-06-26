"""Tests for scripts/gen-eval-fixture.py — the pure scaffold/classification logic.

Everything here exercises importable pure functions: no git, no filesystem. A
mocked `git show` (plain strings for name-status / diff / pre-fix content) drives
build_scaffold end to end.
"""

import pytest
from conftest import load_module

mod = load_module("scripts/gen-eval-fixture.py")


# --------------------------------------------------------------------------- #
# classify_signature
# --------------------------------------------------------------------------- #
def test_classify_code_error():
    sig = "FAILED tests/unit/test_a.py::test_a - assert 1 == 2"
    assert mod.classify_signature(sig) == ("code", "")


@pytest.mark.parametrize(
    "sig, klass",
    [
        ("psycopg.OperationalError: connection refused", "environment"),
        ("Error: connect ECONNREFUSED 127.0.0.1:5432", "environment"),
        ("requests.exceptions.Timeout: request timed out", "environment"),
        ("ruff: command not found", "tool-missing"),
        ("playwright executable not found", "tool-missing"),
    ],
)
def test_classify_non_code(sig, klass):
    got_klass, marker = mod.classify_signature(sig)
    assert got_klass == klass
    assert marker  # a marker substring was recorded


# --------------------------------------------------------------------------- #
# is_source_path
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "path, expected",
    [
        ("app/services/foo.py", True),
        ("frontend/src/routes.ts", True),
        ("logs/test-failures.log", False),
        ("logs/agent/something.json", False),
        (".claude/skills/fix-tests/known-fixes.md", False),
        ("docs/readme.txt", False),
    ],
)
def test_is_source_path(path, expected):
    assert mod.is_source_path(path) is expected


# --------------------------------------------------------------------------- #
# parse_name_status
# --------------------------------------------------------------------------- #
def test_parse_name_status_modify_and_add():
    text = "M\tapp/foo.py\nA\tapp/new.py\n"
    assert mod.parse_name_status(text) == [("M", "app/foo.py"), ("A", "app/new.py")]


def test_parse_name_status_rename_takes_new_path():
    text = "R096\tapp/old.py\tapp/new.py\n"
    assert mod.parse_name_status(text) == [("R", "app/new.py")]


# --------------------------------------------------------------------------- #
# parse_unified_diff + discriminating_lines
# --------------------------------------------------------------------------- #
DIFF = """diff --git a/app/calc.py b/app/calc.py
index 1111111..2222222 100644
--- a/app/calc.py
+++ b/app/calc.py
@@ -1,3 +1,3 @@
 def line_total(qty, price):
-    return qty + price
+    return qty * price
"""


def test_parse_unified_diff_captures_added_removed():
    parsed = mod.parse_unified_diff(DIFF)
    assert "app/calc.py" in parsed
    assert "    return qty * price" in parsed["app/calc.py"]["added"]
    assert "    return qty + price" in parsed["app/calc.py"]["removed"]


def test_discriminating_lines_strips_and_dedupes():
    inc, exc = mod.discriminating_lines(["    return qty * price"], ["    return qty + price"])
    assert inc == ["return qty * price"]
    assert exc == ["return qty + price"]


def test_discriminating_drops_short_lines():
    inc, exc = mod.discriminating_lines(["}", "    foo = bar()"], ["{", "   x"])
    assert inc == ["foo = bar()"]
    assert exc == []  # "{" and "   x" are too short


def test_discriminating_drops_comment_dividers():
    # a comment divider has no alnum signal -> dropped; the real code line stays
    inc, exc = mod.discriminating_lines(
        ["# -----------------------------", "    total = qty * price"], []
    )
    assert inc == ["total = qty * price"]
    assert exc == []


def test_discriminating_drops_removed_that_is_substring_of_added():
    # removed "x = 1" still appears inside added "x = 10" -> can't be excluded
    inc, exc = mod.discriminating_lines(["x = 10"], ["x = 1"])
    assert inc == ["x = 10"]
    assert exc == []


# --------------------------------------------------------------------------- #
# select_source_file
# --------------------------------------------------------------------------- #
def test_select_single_source_file():
    path, reason = mod.select_source_file([("M", "app/foo.py"), ("M", "logs/x.log")])
    assert path == "app/foo.py"
    assert reason is None


def test_select_skips_logs_only():
    path, reason = mod.select_source_file([("M", "logs/test-failures.log")])
    assert path is None
    assert "no source" in reason


def test_select_skips_multi_source():
    path, reason = mod.select_source_file([("M", "app/a.py"), ("M", "app/b.py")])
    assert path is None
    assert "multiple source files" in reason


def test_select_skips_added_file():
    path, reason = mod.select_source_file([("A", "app/new.py")])
    assert path is None
    assert "added in the fix commit" in reason


# --------------------------------------------------------------------------- #
# derive_task_name / artifact_for_skill / choose_providers
# --------------------------------------------------------------------------- #
def test_derive_task_name_stable_and_safe():
    name = mod.derive_task_name("fix-tests", "FAILED a::b - boom", "abcdef1234567")
    assert name.startswith("gen-fix-tests-abcdef1-")
    # deterministic
    assert name == mod.derive_task_name("fix-tests", "FAILED a::b - boom", "abcdef1234567")


def test_artifact_for_skill_known_and_unknown():
    assert mod.artifact_for_skill("fix-tests") == "logs/test-failures.log"
    assert mod.artifact_for_skill("fix-mystery") is None


def test_choose_providers_cheap_vs_capable():
    assert mod.choose_providers(2, 1) == mod.CHEAP_PROVIDERS
    assert mod.choose_providers(20, 1) == mod.CAPABLE_PROVIDERS
    assert mod.choose_providers(2, 3) == mod.CAPABLE_PROVIDERS


# --------------------------------------------------------------------------- #
# render helpers
# --------------------------------------------------------------------------- #
def test_render_seed_log_remaps_source_to_fixture_path():
    log = mod.render_seed_log(
        "fix-tests",
        "FAILED tests/unit/test_a.py::test_a - assert 1 == 2",
        "evals/fixtures/gen-x/test_a.py",
        "tests/unit/test_a.py",
        "abc1234",
    )
    assert "evals/fixtures/gen-x/test_a.py" in log
    assert "tests/unit/test_a.py" not in log  # original path remapped away


def test_render_setup_escapes_backticks():
    setup = mod.render_setup_cjs("fix-tests", "logs/test-failures.log", "a `b` ${c}\n", "abc1234")
    assert "\\`b\\`" in setup
    assert "\\${c}" in setup
    assert "writeLog(worktree, 'logs/test-failures.log', LOG)" in setup


def test_render_verify_embeds_includes_excludes():
    verify = mod.render_verify_cjs("evals/fixtures/x/calc.py", ["return qty * price"], ["return qty + price"], "abc1234")
    assert '"return qty * price"' in verify
    assert '"return qty + price"' in verify
    assert "fixtureMatches(worktree, 'evals/fixtures/x/calc.py'" in verify


# --------------------------------------------------------------------------- #
# build_scaffold — end to end (Skip cases + happy path)
# --------------------------------------------------------------------------- #
def _good_inputs():
    return dict(
        skill="fix-tests",
        signature="FAILED tests/unit/test_calc.py::test_total - assert 8 == 15",
        commit="abcdef1234567",
        name_status=[("M", "app/calc.py")],
        diff_text=DIFF.replace("app/calc.py", "app/calc.py"),
        pre_fix_contents={"app/calc.py": "def line_total(qty, price):\n    return qty + price\n"},
    )


def test_build_scaffold_happy_path():
    res = mod.build_scaffold(**_good_inputs())
    assert isinstance(res, mod.Scaffold)
    assert res.target_source_path == "app/calc.py"
    # fixture placed under evals/fixtures/<task>/<basename>
    fixture_key = f"evals/fixtures/{res.task_name}/calc.py"
    assert fixture_key in res.files
    assert res.files[fixture_key] == "def line_total(qty, price):\n    return qty + price\n"
    # the three task files exist
    for suffix in ("setup.cjs", "verify.cjs", "test.yaml"):
        assert f"evals/tasks/{res.task_name}/{suffix}" in res.files


def test_build_scaffold_test_yaml_is_valid_and_labeled():
    yaml = pytest.importorskip("yaml")
    res = mod.build_scaffold(**_good_inputs())
    assert isinstance(res, mod.Scaffold)
    text = res.files[f"evals/tasks/{res.task_name}/test.yaml"]
    loaded = yaml.safe_load(text)
    entry = loaded[0]
    assert entry["metadata"]["generated"] is True
    assert entry["metadata"]["targets"] == [".claude/skills/fix-tests"]
    assert entry["metadata"]["source_commit"] == "abcdef1234567"
    assert entry["vars"]["prompt"] == "/fix-tests"
    assert entry["vars"]["setup"] == f"tasks/{res.task_name}/setup.cjs"
    assert "baselinePrompt" in entry["vars"]


def test_build_scaffold_skips_environment_signature():
    inp = _good_inputs()
    inp["signature"] = "could not connect to server: Connection refused"
    res = mod.build_scaffold(**inp)
    assert isinstance(res, mod.Skip)
    assert "environment" in res.reason


def test_build_scaffold_skips_unknown_skill():
    inp = _good_inputs()
    inp["skill"] = "fix-mystery"
    res = mod.build_scaffold(**inp)
    assert isinstance(res, mod.Skip)
    assert "unknown fixer skill" in res.reason


def test_build_scaffold_skips_multi_file():
    inp = _good_inputs()
    inp["name_status"] = [("M", "app/calc.py"), ("M", "app/other.py")]
    inp["pre_fix_contents"]["app/other.py"] = "x = 1\n"
    res = mod.build_scaffold(**inp)
    assert isinstance(res, mod.Skip)
    assert "multiple source files" in res.reason


def test_build_scaffold_skips_missing_pre_fix():
    inp = _good_inputs()
    inp["pre_fix_contents"] = {}  # couldn't read parent version
    res = mod.build_scaffold(**inp)
    assert isinstance(res, mod.Skip)
    assert "pre-fix" in res.reason


def test_build_scaffold_skips_non_discriminating_diff():
    inp = _good_inputs()
    # a diff that only adds/removes trivial lines -> nothing distinctive to assert
    inp["diff_text"] = (
        "diff --git a/app/calc.py b/app/calc.py\n"
        "--- a/app/calc.py\n"
        "+++ b/app/calc.py\n"
        "@@ -1,1 +1,1 @@\n"
        "-}\n"
        "+{\n"
    )
    res = mod.build_scaffold(**inp)
    assert isinstance(res, mod.Skip)
    assert "discriminate" in res.reason


def test_build_scaffold_picks_cheap_providers_for_one_liner():
    res = mod.build_scaffold(**_good_inputs())
    assert isinstance(res, mod.Scaffold)
    assert res.providers == mod.CHEAP_PROVIDERS
