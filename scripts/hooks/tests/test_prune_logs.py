"""Tests for scripts/prune-logs.py.

The load-bearing assertion in here is `test_protected_artifact_is_never_pruned`:
the failure artifacts are read by `stop.py` and `diagnostics.py`, which treat a
missing file as "clean". Pruning one by age would turn a stale-but-current
artifact into a silent green.
"""

import time

from conftest import load_module

mod = load_module("scripts/prune-logs.py")

DAY = 86400
NOW = 1_800_000_000.0


def write(path, content="x", age_days=0.0):
    """Create `path` (with parents) and backdate its mtime by `age_days`."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    stamp = NOW - age_days * DAY
    import os

    os.utime(path, (stamp, stamp))
    return path


# --- is_expired ------------------------------------------------------------


def test_is_expired_true_past_the_window():
    assert mod.is_expired(NOW - 31 * DAY, NOW, 30)


def test_is_expired_false_inside_the_window():
    assert not mod.is_expired(NOW - 29 * DAY, NOW, 30)


def test_is_expired_boundary_is_exclusive():
    """Exactly at the limit is kept — only strictly older expires."""
    assert not mod.is_expired(NOW - 30 * DAY, NOW, 30)


def test_is_expired_handles_future_mtime():
    """Clock skew must not make a future-dated file look ancient."""
    assert not mod.is_expired(NOW + 5 * DAY, NOW, 30)


# --- select_expired --------------------------------------------------------


def test_selects_only_old_matching_files(tmp_path):
    write(tmp_path / "agent" / "old.json", age_days=45)
    write(tmp_path / "agent" / "new.json", age_days=1)
    write(tmp_path / "agent" / "keep.md", age_days=45)
    policy = mod.Policy("agent", "*.json", 30, "t")
    found = mod.select_expired(tmp_path, policy, NOW)
    assert [p.name for p in found] == ["old.json"]


def test_protected_artifact_is_never_pruned(tmp_path):
    """A protected name is kept even when it matches a policy and is ancient."""
    write(tmp_path / "lint-errors.log", age_days=999)
    write(tmp_path / "junk.log", age_days=999)
    policy = mod.Policy("", "*.log", 7, "t")
    found = mod.select_expired(tmp_path, policy, NOW)
    assert [p.name for p in found] == ["junk.log"]


def test_every_protected_name_survives_every_policy(tmp_path):
    """Reversion guard: no POLICIES entry may ever select a PROTECTED file."""
    for name in mod.PROTECTED:
        write(tmp_path / name, age_days=999)
        write(tmp_path / "docker" / name, age_days=999)
        write(tmp_path / "agent" / name, age_days=999)
    for policy, paths in mod.plan_prune(tmp_path, NOW):
        assert paths == [], f"{policy.reason} selected a protected artifact"


def test_missing_subdir_is_not_an_error(tmp_path):
    policy = mod.Policy("nope", "*.log", 1, "t")
    assert mod.select_expired(tmp_path, policy, NOW) == []


def test_directories_are_not_selected(tmp_path):
    (tmp_path / "agent" / "sub.json").mkdir(parents=True)
    policy = mod.Policy("agent", "*.json", 1, "t")
    assert mod.select_expired(tmp_path, policy, NOW) == []


def test_selection_is_not_recursive(tmp_path):
    """A rule for one directory must not reach into a nested one."""
    write(tmp_path / "docker" / "nested" / "deep.log", age_days=99)
    policy = mod.Policy("docker", "*.log", 1, "t")
    assert mod.select_expired(tmp_path, policy, NOW) == []


def test_live_runtime_log_survives_backup_policy(tmp_path):
    """`carameli.log.*` prunes backups; `carameli.log` itself must stay."""
    write(tmp_path / "runtime" / "carameli.log", age_days=99)
    write(tmp_path / "runtime" / "carameli.log.3", age_days=99)
    found = [p.name for _, paths in mod.plan_prune(tmp_path, NOW) for p in paths]
    assert "carameli.log.3" in found
    assert "carameli.log" not in found


# --- trim_to_tail ----------------------------------------------------------


def test_trim_noop_under_cap(tmp_path):
    path = write(tmp_path / "events.jsonl", "a\nb\n")
    assert mod.trim_to_tail(path, 1024) == 0
    assert path.read_text(encoding="utf-8") == "a\nb\n"


def test_trim_missing_file_is_noop(tmp_path):
    assert mod.trim_to_tail(tmp_path / "absent.jsonl", 10) == 0


def test_trim_keeps_the_tail_and_frees_bytes(tmp_path):
    path = write(tmp_path / "events.jsonl", "".join(f"line{i}\n" for i in range(1000)))
    original = path.stat().st_size
    freed = mod.trim_to_tail(path, 200)
    assert freed > 0
    assert path.stat().st_size < original
    assert path.read_text(encoding="utf-8").endswith("line999\n")


def test_trim_cuts_on_a_line_boundary(tmp_path):
    """Every retained line must still be whole — no half-written JSON record."""
    path = write(tmp_path / "events.jsonl", "".join(f'{{"n":{i}}}\n' for i in range(500)))
    mod.trim_to_tail(path, 300)
    lines = path.read_text(encoding="utf-8").splitlines()
    assert all(line.startswith('{"n":') and line.endswith("}") for line in lines)


# --- prune / summary -------------------------------------------------------


def test_prune_dry_run_deletes_nothing(tmp_path):
    old = write(tmp_path / "agent" / "old.json", age_days=99)
    deleted, freed = mod.prune(tmp_path, now=NOW, dry_run=True)
    assert deleted == 1
    assert freed > 0
    assert old.exists()


def test_prune_deletes_and_reports(tmp_path):
    old = write(tmp_path / "agent" / "old.json", "content", age_days=99)
    fresh = write(tmp_path / "agent" / "fresh.json", age_days=1)
    deleted, freed = mod.prune(tmp_path, now=NOW)
    assert deleted == 1
    assert freed == len("content")
    assert not old.exists()
    assert fresh.exists()


def test_prune_missing_logs_dir_is_noop(tmp_path):
    assert mod.prune(tmp_path / "absent", now=NOW) == (0, 0)


def test_prune_is_idempotent(tmp_path):
    write(tmp_path / "agent" / "old.json", age_days=99)
    mod.prune(tmp_path, now=NOW)
    assert mod.prune(tmp_path, now=NOW) == (0, 0)


def test_prune_defaults_to_wall_clock(tmp_path):
    """`now=None` uses time.time() rather than crashing on the None arithmetic."""
    write(tmp_path / "agent" / "old.json", age_days=0)
    # Backdate relative to real now, not the frozen NOW constant.
    path = tmp_path / "agent" / "ancient.json"
    path.write_text("x", encoding="utf-8")
    import os

    stamp = time.time() - 99 * DAY
    os.utime(path, (stamp, stamp))
    deleted, _ = mod.prune(tmp_path)
    assert deleted == 1


def test_summary_when_clean():
    assert "nothing to do" in mod.format_summary(0, 0, dry_run=False)


def test_summary_reports_counts():
    assert "removed 3 file(s)" in mod.format_summary(3, 2 * 1024 * 1024, dry_run=False)
    assert "2.0 MB" in mod.format_summary(3, 2 * 1024 * 1024, dry_run=False)


def test_summary_dry_run_uses_conditional_verb():
    assert "would remove" in mod.format_summary(1, 10, dry_run=True)


def test_main_returns_zero(capsys):
    assert mod.main(["--dry-run"]) == 0
    assert "[prune-logs]" in capsys.readouterr().out
