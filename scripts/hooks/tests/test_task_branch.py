"""Unit tests for the shared task-branch helpers (scripts/task_branch.py)."""

import datetime as dt

from conftest import load_module

tb = load_module("scripts/task_branch.py")


class TestParsePrompt:
    def test_extracts_prompt_field(self):
        assert tb.parse_prompt('{"prompt": "add SMS retry"}') == "add SMS retry"

    def test_missing_field_is_empty(self):
        assert tb.parse_prompt('{"other": 1}') == ""

    def test_malformed_json_is_empty(self):
        assert tb.parse_prompt("not json") == ""
        assert tb.parse_prompt("") == ""

    def test_non_string_prompt_is_empty(self):
        assert tb.parse_prompt('{"prompt": 42}') == ""


class TestSlugify:
    def test_basic(self):
        assert tb.slugify("Add SMS retry logic") == "add-sms-retry-logic"

    def test_collapses_punctuation_and_trims(self):
        assert tb.slugify("  Fix: the /webhooks/ bug!! ") == "fix-the-webhooks-bug"

    def test_empty_falls_back(self):
        assert tb.slugify("") == "task"
        assert tb.slugify("!!!") == "task"

    def test_truncates_at_word_boundary(self):
        slug = tb.slugify("word " * 30, max_len=20)
        assert len(slug) <= 20
        assert not slug.endswith("-")


class TestShouldBranch:
    def test_true_on_default(self):
        assert tb.should_branch("master") is True

    def test_false_on_feature_branch(self):
        assert tb.should_branch("claude/foo-0722") is False

    def test_false_on_detached_head(self):
        assert tb.should_branch("") is False

    def test_respects_custom_default(self):
        assert tb.should_branch("main", default_branch="main") is True
        assert tb.should_branch("master", default_branch="main") is False


class TestBranchName:
    def test_includes_prefix_slug_and_date(self):
        assert tb.branch_name("add-sms", set(), today=dt.date(2026, 7, 22)) == "claude/add-sms-0722"

    def test_disambiguates_collision(self):
        existing = {"claude/add-sms-0722"}
        assert (
            tb.branch_name("add-sms", existing, today=dt.date(2026, 7, 22))
            == "claude/add-sms-0722-2"
        )

    def test_disambiguates_multiple_collisions(self):
        existing = {"claude/x-0722", "claude/x-0722-2", "claude/x-0722-3"}
        assert tb.branch_name("x", existing, today=dt.date(2026, 7, 22)) == "claude/x-0722-4"


class TestCheckoutBase:
    def test_clean_tree_bases_on_origin_master(self):
        assert tb.checkout_base(tree_dirty=False) == "origin/master"

    def test_dirty_tree_bases_on_head(self):
        assert tb.checkout_base(tree_dirty=True) is None
