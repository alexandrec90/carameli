"""Unit tests for the branch-per-task UserPromptSubmit hook (pure helpers)."""

import datetime as dt

from conftest import load_module

bpt = load_module("scripts/hooks/branch-per-task.py")


class TestParsePrompt:
    def test_extracts_prompt_field(self):
        assert bpt.parse_prompt('{"prompt": "add SMS retry"}') == "add SMS retry"

    def test_missing_field_is_empty(self):
        assert bpt.parse_prompt('{"other": 1}') == ""

    def test_malformed_json_is_empty(self):
        assert bpt.parse_prompt("not json") == ""
        assert bpt.parse_prompt("") == ""

    def test_non_string_prompt_is_empty(self):
        assert bpt.parse_prompt('{"prompt": 42}') == ""


class TestSlugify:
    def test_basic(self):
        assert bpt.slugify("Add SMS retry logic") == "add-sms-retry-logic"

    def test_collapses_punctuation_and_trims(self):
        assert bpt.slugify("  Fix: the /webhooks/ bug!! ") == "fix-the-webhooks-bug"

    def test_empty_falls_back(self):
        assert bpt.slugify("") == "task"
        assert bpt.slugify("!!!") == "task"

    def test_truncates_at_word_boundary(self):
        slug = bpt.slugify("word " * 30, max_len=20)
        assert len(slug) <= 20
        assert not slug.endswith("-")
        assert "-word" not in slug[-1:]  # no trailing partial


class TestShouldBranch:
    def test_true_on_default(self):
        assert bpt.should_branch("master") is True

    def test_false_on_feature_branch(self):
        assert bpt.should_branch("claude/foo-0722") is False

    def test_false_on_detached_head(self):
        assert bpt.should_branch("") is False

    def test_respects_custom_default(self):
        assert bpt.should_branch("main", default_branch="main") is True
        assert bpt.should_branch("master", default_branch="main") is False


class TestBranchName:
    def test_includes_prefix_slug_and_date(self):
        name = bpt.branch_name("add-sms", set(), today=dt.date(2026, 7, 22))
        assert name == "claude/add-sms-0722"

    def test_disambiguates_collision(self):
        existing = {"claude/add-sms-0722"}
        name = bpt.branch_name("add-sms", existing, today=dt.date(2026, 7, 22))
        assert name == "claude/add-sms-0722-2"

    def test_disambiguates_multiple_collisions(self):
        existing = {"claude/x-0722", "claude/x-0722-2", "claude/x-0722-3"}
        name = bpt.branch_name("x", existing, today=dt.date(2026, 7, 22))
        assert name == "claude/x-0722-4"


class TestCheckoutBase:
    def test_clean_tree_bases_on_origin_master(self):
        assert bpt.checkout_base(tree_dirty=False) == "origin/master"

    def test_dirty_tree_bases_on_head(self):
        assert bpt.checkout_base(tree_dirty=True) is None
