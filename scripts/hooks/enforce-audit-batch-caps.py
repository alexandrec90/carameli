#!/usr/bin/env python3
"""PreToolUse hook: enforces audit-design-flaws Step 2.5 batch caps.

When a raw audit exceeds the violation/touched-file thresholds, edits must be
applied in bounded batches described by `batch-plan.json`. This hook builds that
plan on first trip and blocks (exit 42) write-tool calls that touch files outside
the currently active batch.

Decision logic is exposed as pure functions (`tally`, `build_plan`,
`files_from_tool_payload`, `evaluate_target`) so it can be unit-tested without a
subprocess. See `scripts/hooks/tests/test_enforce_audit_batch_caps.py`.
"""
import json
import re
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

REPO_ROOT = (Path(__file__).parent / '../..').resolve()

VIOLATIONS_THRESHOLD = 25
TOUCHED_FILES_THRESHOLD = 15
PER_BATCH_FILE_CAP = 10
HIGH_RISK_PER_BATCH = 1

WRITE_TOOLS = {'Edit', 'Write', 'MultiEdit', 'apply_patch', 'create_file'}
CHECKS = ('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L')

GROUP_MAP = {
    'low': ('E', 'F', 'G', 'I', 'L'),
    'medium': ('B', 'C', 'J', 'K'),
    'high': ('A', 'D', 'H'),
}
GROUP_LABELS = {
    'low': 'low-risk mechanical',
    'medium': 'medium refactor',
    'high': 'high-risk structural',
}

_PATCH_HEADER_RE = re.compile(r'\*\*\*\s+(?:Update|Add|Delete)\s+File:\s+([^\r\n"]+)')
_POSIX_PATH_RE = re.compile(r'(app|frontend|tests|alembic|scripts|\.claude)/[A-Za-z0-9_\-./]+')
_WIN_PATH_RE = re.compile(r'[A-Za-z]:\\\\[^"\s]+')


def get_value(obj: Any, *paths: str) -> Any:
    """Return the first present dotted-path value from a nested dict."""
    for path in paths:
        cur = obj
        ok = True
        for key in path.split('.'):
            if not isinstance(cur, dict) or key not in cur:
                ok = False
                break
            cur = cur[key]
        if ok:
            return cur
    return None


def to_repo_relative(path: str, base: Path) -> str | None:
    """Normalize a path to a forward-slash repo-relative string, or None."""
    normalized = str(path).replace('\\', '/').strip()
    normalized = re.sub(r'(\\n|/n)+$', '', normalized).strip()
    if not normalized:
        return None

    if re.match(r'^[A-Za-z]:/', normalized):
        base_norm = str(base).replace('\\', '/').rstrip('/')
        prefix = base_norm + '/'
        if normalized.lower().startswith(prefix.lower()):
            return normalized[len(prefix):]
        return None

    return normalized.lstrip('./')


def collect_violation_files(violation: Any, base: Path) -> set[str]:
    """Pull every repo-relative file path referenced by a single violation."""
    found: set[str] = set()
    if not isinstance(violation, dict):
        return found

    if isinstance(violation.get('file'), str):
        rel = to_repo_relative(violation['file'], base)
        if rel:
            found.add(rel)

    if isinstance(violation.get('files'), list):
        for f in violation['files']:
            rel = to_repo_relative(str(f), base)
            if rel:
                found.add(rel)

    if isinstance(violation.get('occurrences'), list):
        for occ in violation['occurrences']:
            if isinstance(occ, dict) and isinstance(occ.get('file'), str):
                rel = to_repo_relative(occ['file'], base)
                if rel:
                    found.add(rel)

    return found


def tally(violations: dict[str, Any], base: Path) -> tuple[int, set[str]]:
    """Return (total violation count, set of all touched files) across checks."""
    total = 0
    touched: set[str] = set()
    for check in CHECKS:
        items = violations.get(check)
        if isinstance(items, list):
            for item in items:
                total += 1
                touched |= collect_violation_files(item, base)
    return total, touched


def chunk(items: list[str], size: int) -> list[list[str]]:
    """Split a list into chunks of at most `size` items."""
    if not items or size <= 0:
        return []
    return [items[i:i + size] for i in range(0, len(items), size)]


def build_batches(violations: dict[str, Any], base: Path, per_batch_cap: int) -> list[dict[str, Any]]:
    """Build the ordered list of batch descriptors from grouped checks."""
    batches: list[dict[str, Any]] = []
    for group_name in ('low', 'medium', 'high'):
        check_ids = GROUP_MAP[group_name]
        group_files: set[str] = set()
        for check_id in check_ids:
            items = violations.get(check_id)
            if isinstance(items, list):
                for item in items:
                    group_files |= collect_violation_files(item, base)

        group_file_list = sorted(group_files)
        if not group_file_list:
            continue

        chunk_size = HIGH_RISK_PER_BATCH if group_name == 'high' else per_batch_cap
        for idx, files in enumerate(chunk(group_file_list, chunk_size), start=1):
            batches.append({
                'id': f'{group_name}-{idx}',
                'group': GROUP_LABELS[group_name],
                'checks': list(check_ids),
                'maxFiles': chunk_size,
                'files': files,
                'status': 'pending',
            })
    return batches


def build_plan(violations: dict[str, Any], base: Path, total: int, touched: int) -> dict[str, Any]:
    """Build the full batch-plan.json payload."""
    batches = build_batches(violations, base, PER_BATCH_FILE_CAP)
    first_id = batches[0]['id'] if batches else None
    return {
        'version': 1,
        'generatedAt': datetime.now(UTC).isoformat(),
        'thresholds': {
            'violations': VIOLATIONS_THRESHOLD,
            'touchedFiles': TOUCHED_FILES_THRESHOLD,
            'perBatchFiles': PER_BATCH_FILE_CAP,
            'highRiskPerBatch': HIGH_RISK_PER_BATCH,
        },
        'totals': {'violations': total, 'touchedFiles': touched},
        'batches': batches,
        'currentBatchId': first_id,
    }


def files_from_tool_payload(payload: dict[str, Any], base: Path) -> list[str]:
    """Best-effort extraction of repo-relative target files from a tool payload."""
    tool_input = get_value(payload, 'tool_input', 'toolInput', 'input')
    if tool_input is None:
        return []

    try:
        blob = json.dumps(tool_input, separators=(',', ':'))
    except (TypeError, ValueError):
        blob = str(tool_input)

    found: set[str] = set()
    for match in _PATCH_HEADER_RE.findall(blob):
        rel = to_repo_relative(match, base)
        if rel:
            found.add(rel)
    for match in _POSIX_PATH_RE.finditer(blob):
        rel = to_repo_relative(match.group(0), base)
        if rel:
            found.add(rel)
    for match in _WIN_PATH_RE.findall(blob):
        rel = to_repo_relative(match.replace('\\\\', '/'), base)
        if rel:
            found.add(rel)

    return sorted(found)


def find_batch(plan: dict[str, Any], active_id: str | None) -> dict[str, Any] | None:
    """Locate the active batch descriptor in a plan."""
    if not active_id:
        active_id = plan.get('currentBatchId')
    for batch in plan.get('batches', []) or []:
        if isinstance(batch, dict) and str(batch.get('id')) == str(active_id):
            return batch
    return None


def evaluate_target(current_batch: dict[str, Any], target_files: list[str]) -> tuple[int, list[str]]:
    """Pure enforcement: map a batch + target files to (exit_code, messages)."""
    if not target_files:
        # Can't infer target paths reliably; fail open to avoid false positives.
        return 0, []

    max_files = int(current_batch.get('maxFiles', PER_BATCH_FILE_CAP))
    if len(target_files) > max_files:
        return 42, [
            f"Blocked: current batch '{current_batch.get('id')}' allows at most "
            f'{max_files} files per edit operation (got {len(target_files)}).'
        ]

    batch_files = {str(f).replace('\\', '/') for f in (current_batch.get('files') or [])}
    outside = [f.replace('\\', '/') for f in target_files if f.replace('\\', '/') not in batch_files]

    if outside:
        return 42, [
            f"Blocked by Step 2.5 caps: current batch '{current_batch.get('id')}' "
            f"({current_batch.get('group')}) only permits files listed in batch-plan.json.",
            'Out-of-batch file(s): ' + ', '.join(outside[:5]),
            'Update batch-active.json to the correct batch before editing these files.',
        ]

    return 0, []


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding='utf-8-sig'))


def main() -> int:
    raw = sys.stdin.read()
    if not raw.strip():
        return 0

    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return 0  # fail open on malformed hook payload

    tool_name = get_value(payload, 'tool_name', 'toolName', 'tool.name', 'name')
    if tool_name not in WRITE_TOOLS:
        return 0

    skill_dir = REPO_ROOT / '.claude/skills/audit-design-flaws'
    raw_audit_path = skill_dir / 'raw-audit.json'
    plan_path = skill_dir / 'batch-plan.json'
    active_path = skill_dir / 'batch-active.json'

    if not raw_audit_path.exists():
        return 0

    try:
        raw_audit = _load_json(raw_audit_path)
    except (OSError, json.JSONDecodeError):
        return 0  # fail open when artifact is malformed

    violations = raw_audit.get('violations') if isinstance(raw_audit, dict) else None
    if not violations:
        return 0

    total, touched_set = tally(violations, REPO_ROOT)
    touched = len(touched_set)
    if total <= VIOLATIONS_THRESHOLD and touched <= TOUCHED_FILES_THRESHOLD:
        return 0

    if not plan_path.exists():
        plan = build_plan(violations, REPO_ROOT, total, touched)
        plan_path.write_text(json.dumps(plan, indent=2) + '\n', encoding='utf-8')
        if plan.get('currentBatchId'):
            active_path.write_text(
                json.dumps({'currentBatchId': plan['currentBatchId']}, indent=2) + '\n',
                encoding='utf-8',
            )

    try:
        plan = _load_json(plan_path)
    except (OSError, json.JSONDecodeError):
        return 42

    active_id = None
    if active_path.exists():
        try:
            active_id = str(_load_json(active_path).get('currentBatchId'))
        except (OSError, json.JSONDecodeError, AttributeError):
            active_id = None

    current_batch = find_batch(plan, active_id)
    if not current_batch:
        print('Blocked: Step 2.5 batch caps are active but no current batch is selected.')
        print('Set .claude/skills/audit-design-flaws/batch-active.json with '
              '{"currentBatchId":"<batch-id>"}.')
        return 42

    target_files = files_from_tool_payload(payload, REPO_ROOT)
    exit_code, messages = evaluate_target(current_batch, target_files)
    for message in messages:
        print(message)
    return exit_code


if __name__ == '__main__':
    sys.exit(main())
