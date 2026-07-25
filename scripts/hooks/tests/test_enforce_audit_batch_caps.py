"""Unit tests for the audit-design-flaws Step 2.5 batch-cap enforcer."""

from datetime import UTC, datetime, timedelta
from pathlib import Path

from conftest import load_module

hook = load_module("scripts/hooks/enforce-audit-batch-caps.py")

BASE = Path("/repo")


def test_to_repo_relative_posix():
    assert hook.to_repo_relative("app/models/user.py", BASE) == "app/models/user.py"
    assert hook.to_repo_relative("./tests/test_x.py", BASE) == "tests/test_x.py"
    assert (
        hook.to_repo_relative(".claude/skills/test-skill/.active", BASE)
        == ".claude/skills/test-skill/.active"
    )


def test_to_repo_relative_backslashes():
    assert hook.to_repo_relative("app\\services\\sms.py", BASE) == "app/services/sms.py"


def test_to_repo_relative_windows_absolute_inside_base():
    base = Path("C:/repo")
    assert hook.to_repo_relative("C:/repo/app/x.py", base) == "app/x.py"
    # case-insensitive drive/prefix match
    assert hook.to_repo_relative("c:/REPO/app/x.py", base) == "app/x.py"


def test_to_repo_relative_outside_base_is_none():
    base = Path("C:/repo")
    assert hook.to_repo_relative("C:/other/app/x.py", base) is None
    assert hook.to_repo_relative("   ", base) is None


def test_collect_violation_files_all_shapes():
    violation = {
        "file": "app/a.py",
        "files": ["app/b.py", "app/c.py"],
        "occurrences": [{"file": "app/d.py"}, {"note": "no file"}],
    }
    assert hook.collect_violation_files(violation, BASE) == {
        "app/a.py",
        "app/b.py",
        "app/c.py",
        "app/d.py",
    }


def test_tally_counts_and_touched():
    violations = {
        "A": [{"file": "app/a.py"}, {"file": "app/b.py"}],
        "E": [{"files": ["app/a.py"]}],  # duplicate file, still counts as a violation
        "Z": [{"file": "ignored.py"}],  # not a known check id
    }
    total, touched = hook.tally(violations, BASE)
    assert total == 3
    assert touched == {"app/a.py", "app/b.py"}


def test_chunk():
    assert hook.chunk(["a", "b", "c"], 2) == [["a", "b"], ["c"]]
    assert hook.chunk([], 2) == []
    assert hook.chunk(["a"], 0) == []


def test_build_batches_high_risk_is_one_file_per_batch():
    violations = {
        "A": [{"file": "app/h1.py"}, {"file": "app/h2.py"}],  # high group
        "E": [{"file": "app/l1.py"}, {"file": "app/l2.py"}],  # low group
    }
    batches = hook.build_batches(violations, BASE, per_batch_cap=10)
    high = [b for b in batches if b["group"] == "high-risk structural"]
    low = [b for b in batches if b["group"] == "low-risk mechanical"]
    assert len(high) == 2 and all(b["maxFiles"] == 1 for b in high)
    assert len(low) == 1 and low[0]["maxFiles"] == 10
    assert sorted(low[0]["files"]) == ["app/l1.py", "app/l2.py"]


def test_files_from_tool_payload_extracts_paths():
    payload = {"tool_input": {"file_path": "app/services/sms.py", "content": "x"}}
    assert hook.files_from_tool_payload(payload, BASE) == ["app/services/sms.py"]


def test_files_from_tool_payload_patch_header():
    payload = {"tool_input": {"input": "*** Update File: app/models/user.py"}}
    assert "app/models/user.py" in hook.files_from_tool_payload(payload, BASE)


def test_files_from_codex_multiline_patch_does_not_absorb_patch_body():
    payload = {
        "tool_name": "apply_patch",
        "tool_input": {
            "input": (
                "*** Begin Patch\n"
                "*** Add File: logs/codex-live-edit-probe.py\n"
                "+x=1\n"
                "*** End Patch\n"
            )
        },
    }
    assert hook.files_from_tool_payload(payload, BASE) == ["logs/codex-live-edit-probe.py"]


def test_files_from_tool_payload_windows_path():
    base = Path("C:/repo")
    payload = {"tool_input": {"file_path": r"C:\repo\scripts\hooks\x.py"}}
    assert hook.files_from_tool_payload(payload, base) == ["scripts/hooks/x.py"]


def test_find_batch_falls_back_to_current_id():
    plan = {"currentBatchId": "low-1", "batches": [{"id": "low-1", "files": []}]}
    assert hook.find_batch(plan, None)["id"] == "low-1"
    assert hook.find_batch(plan, "missing") is None


def test_evaluate_target_within_batch_allows():
    batch = {"id": "low-1", "group": "low-risk mechanical", "maxFiles": 10, "files": ["app/a.py"]}
    assert hook.evaluate_target(batch, ["app/a.py"]) == (0, [])


def test_evaluate_target_empty_fails_open():
    batch = {"id": "low-1", "maxFiles": 10, "files": ["app/a.py"]}
    assert hook.evaluate_target(batch, []) == (0, [])


def test_evaluate_target_allows_test_skill_control_marker():
    batch = {"id": "low-1", "maxFiles": 1, "files": ["app/a.py"]}
    assert hook.evaluate_target(batch, [".claude/skills/test-skill/.active"]) == (0, [])


def test_evaluate_target_ignores_control_marker_in_mixed_edit():
    batch = {"id": "low-1", "maxFiles": 1, "files": ["app/a.py"]}
    assert hook.evaluate_target(
        batch,
        ["app/a.py", ".claude/skills/test-skill/.active"],
    ) == (0, [])


def test_evaluate_target_allows_audit_batch_pointer():
    batch = {"id": "low-1", "maxFiles": 1, "files": ["app/a.py"]}
    assert hook.evaluate_target(
        batch,
        [".claude/skills/audit-design-flaws/batch-active.json"],
    ) == (0, [])


def test_evaluate_target_too_many_files_blocks():
    batch = {"id": "high-1", "maxFiles": 1, "files": ["app/a.py", "app/b.py"]}
    code, messages = hook.evaluate_target(batch, ["app/a.py", "app/b.py"])
    assert code == hook.EXIT_BLOCK
    assert "at most 1 files" in messages[0]


def test_evaluate_target_out_of_batch_blocks():
    batch = {"id": "low-1", "group": "low-risk mechanical", "maxFiles": 10, "files": ["app/a.py"]}
    code, messages = hook.evaluate_target(batch, ["app/zzz.py"])
    assert code == hook.EXIT_BLOCK
    assert any("app/zzz.py" in m for m in messages)


# --- plan_is_stale: a leftover plan must not arm the gate forever ---
#
# Regression: a batch plan generated 2026-05-25 was still gating every edit in
# the repo two months later, because the hook armed on the plan file merely
# existing. It went unnoticed only because the hook's exit code (42) meant it
# never actually blocked -- see test_hook_exit_contract.py.


def _plan(stamp):
    return {"version": 1, "generatedAt": stamp, "batches": []}


def test_fresh_plan_is_not_stale():
    now = datetime(2026, 7, 25, tzinfo=UTC)
    assert hook.plan_is_stale(_plan("2026-07-24T00:00:00Z"), now) is False


def test_plan_at_the_age_limit_is_not_stale():
    now = datetime(2026, 7, 25, tzinfo=UTC)
    edge = now - timedelta(days=hook.PLAN_MAX_AGE_DAYS)
    assert hook.plan_is_stale(_plan(edge.isoformat()), now) is False


def test_plan_past_the_age_limit_is_stale():
    now = datetime(2026, 7, 25, tzinfo=UTC)
    old = now - timedelta(days=hook.PLAN_MAX_AGE_DAYS + 1)
    assert hook.plan_is_stale(_plan(old.isoformat()), now) is True


def test_the_real_stale_plan_that_caused_this():
    now = datetime(2026, 7, 25, tzinfo=UTC)
    assert hook.plan_is_stale(_plan("2026-05-25T00:51:38.8295838Z"), now) is True


def test_naive_timestamp_is_treated_as_utc():
    now = datetime(2026, 7, 25, tzinfo=UTC)
    assert hook.plan_is_stale(_plan("2026-07-24T00:00:00"), now) is False


def test_unattributable_plan_is_stale():
    """No usable generatedAt -> stand down rather than gate on an unknown plan."""
    now = datetime(2026, 7, 25, tzinfo=UTC)
    assert hook.plan_is_stale({"batches": []}, now) is True
    assert hook.plan_is_stale(_plan(""), now) is True
    assert hook.plan_is_stale(_plan("not-a-date"), now) is True
    assert hook.plan_is_stale(None, now) is True
