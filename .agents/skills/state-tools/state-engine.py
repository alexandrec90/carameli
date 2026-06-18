from __future__ import annotations

import argparse
import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

SCRIPT_VERSION = "1"
VALID_AUDIT_STATUS = {"pass", "violation", "fixed", "stale"}
VALID_SCHEMAS = ("audit", "modules", "files")

EXCLUDED_DIR_NAMES = {"node_modules", ".venv", ".git", "__pycache__", "dist", "build"}
EXCLUDED_PREFIXES = {"alembic/versions/", ".claude/"}


@dataclass(frozen=True)
class CheckSpec:
    check_id: str
    kind: str  # local | cross
    include_globs: tuple[str, ...]


CHECK_SPECS: tuple[CheckSpec, ...] = (
    CheckSpec("A", "local", ("app/**/*.py", "frontend/src/**/*.ts", "frontend/src/**/*.tsx")),
    CheckSpec("B", "cross", ("app/**/*.py", "frontend/src/**/*.ts", "frontend/src/**/*.tsx")),
    CheckSpec("C", "cross", ("frontend/src/**/*.ts", "frontend/src/**/*.tsx")),
    CheckSpec("D", "cross", ("app/**/*.py", "frontend/src/**/*.ts", "frontend/src/**/*.tsx")),
    CheckSpec("E", "local", ("app/**/*.py", "frontend/src/**/*.ts", "frontend/src/**/*.tsx")),
    CheckSpec("F", "local", ("frontend/src/**/*.ts", "frontend/src/**/*.tsx")),
    CheckSpec("G", "local", ("app/**/*.py", "frontend/src/**/*.ts", "frontend/src/**/*.tsx")),
    CheckSpec("H", "local", ("frontend/src/**/*.ts", "frontend/src/**/*.tsx")),
    CheckSpec("I", "local", ("tests/**/*.py", "frontend/src/**/*.ts", "frontend/src/**/*.tsx")),
    CheckSpec("J", "cross", ("tests/test_*.py", "tests/**/test_*.py")),
    CheckSpec(
        "K",
        "cross",
        (
            "app/services/**/*.py",
            "app/repositories/**/*.py",
            "frontend/src/hooks/**/*.ts",
            "frontend/src/hooks/**/*.tsx",
            "frontend/src/lib/**/*.ts",
            "frontend/src/lib/**/*.tsx",
        ),
    ),
    CheckSpec("L", "local", ("app/**/*.py", "frontend/src/**/*.ts", "frontend/src/**/*.tsx")),
)


# ---------- shared helpers ----------


def load_json(path: Path, default: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return default
    # utf-8-sig transparently handles BOM-prefixed files (e.g. PowerShell 5.1
    # Set-Content -Encoding utf8) without breaking on plain UTF-8.
    raw = json.loads(path.read_text(encoding="utf-8-sig"))
    if not isinstance(raw, dict):
        return default
    return raw


def parse_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_hash(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def to_posix(path: Path) -> str:
    return path.as_posix()


def resolve_path(repo_root: Path, value: str) -> Path:
    candidate = Path(value)
    if candidate.is_absolute():
        return candidate
    return (repo_root / candidate).resolve()


def skill_path(skill: str, filename: str) -> str:
    return f".claude/skills/{skill}/{filename}"


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


# ---------- audit planning ----------


def check_signature(spec: CheckSpec) -> str:
    payload = {
        "scriptVersion": SCRIPT_VERSION,
        "check": spec.check_id,
        "kind": spec.kind,
        "include": list(spec.include_globs),
    }
    return sha256_bytes(json.dumps(payload, sort_keys=True).encode("utf-8"))[:16]


def is_excluded(rel_path: str) -> bool:
    if any(rel_path.startswith(prefix) for prefix in EXCLUDED_PREFIXES):
        return True
    parts = rel_path.split("/")
    return any(part in EXCLUDED_DIR_NAMES for part in parts)


def gather_files(repo_root: Path, globs: tuple[str, ...]) -> list[str]:
    found: set[str] = set()
    for pattern in globs:
        for path in repo_root.glob(pattern):
            if not path.is_file():
                continue
            rel = to_posix(path.relative_to(repo_root))
            if is_excluded(rel):
                continue
            found.add(rel)
    return sorted(found)


def build_audit_plan(repo_root: Path, state: dict[str, Any]) -> dict[str, Any]:
    checks_state = state.get("checks", {}) if isinstance(state.get("checks"), dict) else {}

    plan: dict[str, Any] = {
        "version": 1,
        "generatedAt": datetime.now(UTC).isoformat(),
        "scriptVersion": SCRIPT_VERSION,
        "checks": {},
    }

    for spec in CHECK_SPECS:
        cur_sig = check_signature(spec)
        prev_entry = (
            checks_state.get(spec.check_id, {})
            if isinstance(checks_state.get(spec.check_id), dict)
            else {}
        )
        prev_sig = prev_entry.get("checkSignature")
        prev_files = (
            prev_entry.get("files", {}) if isinstance(prev_entry.get("files"), dict) else {}
        )

        signature_changed = prev_sig != cur_sig
        candidates = gather_files(repo_root, spec.include_globs)

        targets: list[str] = []
        skipped: list[str] = []

        for rel in candidates:
            abs_path = repo_root / rel
            cur_hash = file_hash(abs_path)
            prev_meta = prev_files.get(rel, {}) if isinstance(prev_files.get(rel), dict) else {}
            prev_hash = prev_meta.get("contentHash")
            prev_status = str(prev_meta.get("status", "")).lower()

            # "fixed" is final for unchanged files; only active violations or
            # stale markers force a rescan.
            is_active_violation = prev_status in {"violation", "stale"}
            needs_scan = (
                signature_changed or prev_hash != cur_hash or not prev_meta or is_active_violation
            )

            if needs_scan:
                targets.append(rel)
            else:
                skipped.append(rel)

        removed = sorted(set(prev_files.keys()) - set(candidates))
        rebuild_facts = spec.kind == "cross" and (
            signature_changed or bool(targets) or bool(removed)
        )

        plan["checks"][spec.check_id] = {
            "kind": spec.kind,
            "checkSignature": cur_sig,
            "signatureChanged": signature_changed,
            "candidateCount": len(candidates),
            "targetCount": len(targets),
            "targets": targets,
            "skipped": skipped,
            "removed": removed,
            "rebuildFacts": rebuild_facts,
        }

    return plan


# ---------- apply: audit ----------


def normalize_audit_status(value: Any) -> str:
    if isinstance(value, str):
        status = value.strip().lower()
        if status in VALID_AUDIT_STATUS:
            return status
    return "pass"


def normalize_summary(value: Any) -> str | None:
    if isinstance(value, str):
        summary = value.strip()
        if summary:
            return summary
    return None


def parse_audit_result(
    results: dict[str, Any], check_id: str, rel_path: str
) -> tuple[str, str | None]:
    checks = results.get("checks", {})
    if not isinstance(checks, dict):
        return "pass", None

    check_entry = checks.get(check_id, {})
    if not isinstance(check_entry, dict):
        return "pass", None

    files = check_entry.get("files", {})
    if not isinstance(files, dict):
        return "pass", None

    value = files.get(rel_path)
    if isinstance(value, str):
        return normalize_audit_status(value), None

    if isinstance(value, dict):
        return normalize_audit_status(value.get("status")), normalize_summary(value.get("summary"))

    return "pass", None


def apply_audit_state(
    *,
    repo_root: Path,
    state: dict[str, Any],
    plan: dict[str, Any],
    results: dict[str, Any],
    scan_date: str,
) -> dict[str, Any]:
    checks_state = state.setdefault("checks", {})
    if not isinstance(checks_state, dict):
        checks_state = {}
        state["checks"] = checks_state

    plan_checks = plan.get("checks", {})
    if not isinstance(plan_checks, dict):
        return state

    for check_id, plan_entry in plan_checks.items():
        if not isinstance(check_id, str) or not isinstance(plan_entry, dict):
            continue

        check_state = checks_state.setdefault(check_id, {})
        if not isinstance(check_state, dict):
            check_state = {}
            checks_state[check_id] = check_state

        check_state["checkSignature"] = plan_entry.get(
            "checkSignature", check_state.get("checkSignature", "")
        )

        files_state = check_state.setdefault("files", {})
        if not isinstance(files_state, dict):
            files_state = {}
            check_state["files"] = files_state

        removed = plan_entry.get("removed", [])
        if isinstance(removed, list):
            for rel_path in removed:
                if isinstance(rel_path, str):
                    files_state.pop(rel_path, None)

        targets = plan_entry.get("targets", [])
        if not isinstance(targets, list):
            continue

        for rel_path in targets:
            if not isinstance(rel_path, str):
                continue

            abs_path = repo_root / rel_path
            if not abs_path.exists() or not abs_path.is_file():
                files_state.pop(rel_path, None)
                continue

            status, summary = parse_audit_result(results, check_id=check_id, rel_path=rel_path)
            record: dict[str, Any] = {
                "contentHash": file_hash(abs_path),
                "lastScanned": scan_date,
                "status": status,
            }
            if summary:
                record["summary"] = summary

            files_state[rel_path] = record

    return state


# ---------- apply: modules ----------


def apply_module_state(
    *, state: dict[str, Any], updates: dict[str, Any], today: str
) -> dict[str, Any]:
    existing_modules = state.get("modules", [])
    if not isinstance(existing_modules, list):
        existing_modules = []

    index: dict[str, dict[str, Any]] = {}
    for row in existing_modules:
        if not isinstance(row, dict):
            continue
        module = row.get("module")
        if isinstance(module, str) and module:
            index[module] = dict(row)

    update_rows = updates.get("modules", [])
    if not isinstance(update_rows, list):
        update_rows = []

    for row in update_rows:
        if not isinstance(row, dict):
            continue

        module = row.get("module")
        if not isinstance(module, str) or not module:
            continue

        merged = index.get(module, {"module": module})
        merged["module"] = module

        if isinstance(row.get("test_file"), str) and row["test_file"]:
            merged["test_file"] = row["test_file"]

        if isinstance(row.get("git_hash"), str) and row["git_hash"]:
            merged["git_hash"] = row["git_hash"]

        if "gaps_found" in row:
            merged["gaps_found"] = parse_int(row.get("gaps_found"), default=0)

        merged["last_reviewed"] = (
            row.get("last_reviewed") if isinstance(row.get("last_reviewed"), str) else today
        )

        index[module] = merged

    state["modules"] = [index[key] for key in sorted(index.keys())]
    state["last_run"] = (
        updates.get("last_run") if isinstance(updates.get("last_run"), str) else today
    )

    return state


# ---------- apply: files ----------


def apply_files_state(
    *, state: dict[str, Any], updates: dict[str, Any], today: str
) -> dict[str, Any]:
    files_state = state.get("files", {})
    if not isinstance(files_state, dict):
        files_state = {}

    updates_files = updates.get("files", {})
    if not isinstance(updates_files, dict):
        updates_files = {}

    for rel_path, patch in updates_files.items():
        if not isinstance(rel_path, str) or not rel_path:
            continue

        if patch is None:
            continue

        if isinstance(patch, dict) and patch.get("remove") is True:
            files_state.pop(rel_path, None)
            continue

        entry = files_state.get(rel_path, {})
        if not isinstance(entry, dict):
            entry = {}

        if isinstance(patch, str):
            entry["git_hash"] = patch
            entry["refactored_at"] = today
            files_state[rel_path] = entry
            continue

        if not isinstance(patch, dict):
            continue

        if isinstance(patch.get("git_hash"), str) and patch["git_hash"]:
            entry["git_hash"] = patch["git_hash"]

        if isinstance(patch.get("refactored_at"), str) and patch["refactored_at"]:
            entry["refactored_at"] = patch["refactored_at"]
        elif "git_hash" in entry:
            entry["refactored_at"] = today

        files_state[rel_path] = entry

    state["files"] = files_state
    return state


# ---------- CLI ----------


def add_common_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--repo-root", default=".", help="Repository root (default: current directory)"
    )
    parser.add_argument("--skill", required=True, help="Skill folder name under .claude/skills/")
    parser.add_argument("--state-file", default="", help="Override state.json path")
    parser.add_argument("--out", default="", help="Override output path")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="State engine for .claude skill state.json workflows."
    )
    sub = parser.add_subparsers(dest="command", required=True)

    plan_p = sub.add_parser("plan", help="Build an incremental audit scan plan.")
    add_common_args(plan_p)

    apply_p = sub.add_parser("apply", help="Apply updates to a skill's state.json.")
    add_common_args(apply_p)
    apply_p.add_argument("--schema", required=True, choices=VALID_SCHEMAS)
    apply_p.add_argument(
        "--updates-file", default="", help="(modules/files) override state-updates.json path"
    )
    apply_p.add_argument("--scan-plan", default="", help="(audit) override scan-plan.json path")
    apply_p.add_argument(
        "--results-file", default="", help="(audit) override scan-results.json path"
    )
    apply_p.add_argument("--today", default="", help="Override date YYYY-MM-DD")

    return parser.parse_args()


def cmd_plan(args: argparse.Namespace, repo_root: Path) -> int:
    state_path = resolve_path(repo_root, args.state_file or skill_path(args.skill, "state.json"))
    out_path = resolve_path(repo_root, args.out or skill_path(args.skill, "scan-plan.json"))

    state = load_json(state_path, {"checks": {}})
    plan = build_audit_plan(repo_root=repo_root, state=state)
    write_json(out_path, plan)
    return 0


def cmd_apply(args: argparse.Namespace, repo_root: Path) -> int:
    today = args.today.strip() or datetime.now(UTC).date().isoformat()
    state_path = resolve_path(repo_root, args.state_file or skill_path(args.skill, "state.json"))
    out_path = resolve_path(repo_root, args.out) if args.out else state_path

    if args.schema == "audit":
        plan_path = resolve_path(
            repo_root, args.scan_plan or skill_path(args.skill, "scan-plan.json")
        )
        results_path = resolve_path(
            repo_root, args.results_file or skill_path(args.skill, "scan-results.json")
        )
        state = load_json(state_path, {"checks": {}})
        plan = load_json(plan_path, {"checks": {}})
        results = load_json(results_path, {"checks": {}})
        merged = apply_audit_state(
            repo_root=repo_root, state=state, plan=plan, results=results, scan_date=today
        )

    elif args.schema == "modules":
        updates_path = resolve_path(
            repo_root, args.updates_file or skill_path(args.skill, "state-updates.json")
        )
        state = load_json(state_path, {"last_run": None, "modules": []})
        updates = load_json(updates_path, {"modules": []})
        merged = apply_module_state(state=state, updates=updates, today=today)

    else:  # files
        updates_path = resolve_path(
            repo_root, args.updates_file or skill_path(args.skill, "state-updates.json")
        )
        state = load_json(state_path, {"files": {}})
        updates = load_json(updates_path, {"files": {}})
        merged = apply_files_state(state=state, updates=updates, today=today)

    write_json(out_path, merged)
    return 0


def main() -> int:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    if args.command == "plan":
        return cmd_plan(args, repo_root)
    if args.command == "apply":
        return cmd_apply(args, repo_root)
    raise SystemExit(f"Unknown command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
