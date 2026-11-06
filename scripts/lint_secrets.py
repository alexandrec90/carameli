"""The detect-secrets pass of `scripts/lint-all.py`, and the baseline diffing it needs.

Split out of `lint-all.py`, which had been recorded past `file_lines` four times running
while this block was the seam every record named. The runner keeps `t_detect_secrets`,
the `--changed` gate and its place in `LOCAL_TOOLS`; the scan and everything about the
committed `.secrets.baseline` lives here. `root` and `run` are passed in rather than
imported, so the runner's own `REPO_ROOT` and `run` stay the single thing a test repoints.
"""

import json
import re
import shutil
from collections.abc import Callable
from pathlib import Path

Run = Callable[[str], tuple[list[str], int]]
Result = dict[str, tuple[list[str], int]]

# Files detect-secrets must not scan. This has to stay byte-identical to the
# `exclude:` on the detect-secrets hook in `.pre-commit-config.yaml`, which carries
# the rationale for each entry -- the two tools scanning different file sets is not
# a difference of opinion, it is drift that never converges: whatever only this
# side sees gets written into `.secrets.baseline` on every run, while the
# pre-commit hook keeps passing on the committed baseline because it never looked.
# That is exactly how DEVKIT_FILES.json's 42 hashes came to be baselined and then
# rewritten by every clean-tree lint run once a `sync-devkit.py --pull` moved one.
# `test_secrets_exclude_matches_pre_commit` fails if the two ever diverge again.
SECRETS_EXCLUDE_RE = r"(\.secrets\.baseline|\.env\.example|DEVKIT_FILES\.json)$"


def absent() -> Result | None:
    """A clean skip when `detect-secrets` is not on PATH, else None. Asked first.

    The two answers read as opposite things and the code gave them the same words. A
    scan that *ran* and exited non-zero says the repository has a problem; a
    `detect-secrets` that is not installed -- the normal state of a fresh worktree,
    which checks out tracked files only and has no `.venv` -- says the machine does.
    Both printed `detect-secrets: scan failed (exit 1)`, so the second read as the
    first.

    "not installed" is the exact phrase `failure_class.get_skip_reason` classifies as
    environmental, which is what keeps it out of the failure artifact. That is the
    opposite of `lint-all.py`'s `_GIT_UNAVAILABLE_LINE`, whose wording deliberately
    avoids the phrase: there the tool IS present and nothing was linted, which must
    stay loud.
    """
    if shutil.which("detect-secrets") is not None:
        return None
    # "is not installed" is the exact phrase `failure_class._MISSING_TOOL` matches, so
    # the line classifies as environmental wherever it is read, not only here.
    return {"detect-secrets": (["detect-secrets is not installed -- skipped"], 0)}


def normalize(text: str) -> str:
    """The baseline with its `generated_at` blanked: the timestamp churns every run."""
    return re.sub(r'"generated_at":\s*"[^"]*"', '"generated_at": ""', text)


def entries(text: str) -> dict[tuple[str, str], dict]:
    """Each finding a baseline records, by `(file, hashed_secret)`; empty if unparsable."""
    try:
        data = json.loads(text)
    except ValueError:
        return {}
    return {
        (file, s.get("hashed_secret", "")): s
        for file, secrets in (data.get("results") or {}).items()
        for s in secrets
    }


def hashes(text: str) -> set[tuple[str, str]]:
    """`(file, hashed_secret)` for every finding a baseline records; empty if unparsable."""
    return set(entries(text))


def refusal(before: str, after: str) -> list[str]:
    """What the pre-commit hook would refuse: the findings `after` has and `before` lacks.

    Empty when there are none. Each line opens with a word `_keep_detect_secrets` in
    `scripts/diagnostics.py` keeps, or the failure runs and is dropped from the artifact.
    """
    known = hashes(before)
    new = {key: entry for key, entry in entries(after).items() if key not in known}
    lines: list[str] = []
    for (file, _), entry in sorted(new.items(), key=lambda item: item[0]):
        kind = entry.get("type", "Secret")
        lines += [
            f"ERROR: Potential secret not in .secrets.baseline: {kind}",
            f"Location: {file}:{entry.get('line_number', '?')}",
        ]
    if lines:
        lines.append(
            "ERROR: the commit stage refuses this. Move a real secret out of the source; "
            "mark a false positive with an inline `pragma: allowlist secret` comment."
        )
    return lines


def report() -> None:
    """Say that a scan moved known findings in the baseline, for `git diff` review."""
    print(
        "  [auto-fix] detect-secrets: baseline entries updated (removed/relocated)"
        " -- review with: git diff .secrets.baseline"
    )


def scan(root: Path, run: Run) -> Result:
    """Scan for secrets; fail on a new finding, keep the baseline current on a moved one.

    A finding the baseline does not hold fails this pass with its `file:line`, and the
    baseline is put back. It used to be written in and reported green, which is the one
    answer the pre-commit hook does not give: the hook refuses that finding at the commit
    stage unless the acknowledgement is part of the change, so a lint run could pass what
    the commit then refused. And an acknowledgement nobody chose is what the note on the
    hook in `.pre-commit-config.yaml` warns about, re-baselining on autopilot.

    A finding is new by `(file, hashed_secret)`, which is how the hook matches too; only
    a line number moving, or a finding going away, rewrites the baseline. Changes are
    read from the baseline's results, ignoring the `generated_at` timestamp, which churns
    every run and is restored when it is the only change. CI drops this pass, and the
    Stop path passes `--no-secrets`, so this runs when `lint-all.py` is asked to.
    NB: the update flag is `--baseline`; `--update` does not exist in detect-secrets
    1.5 -- the old call using it failed silently, which is why findings were
    re-reported as "new" on every run without ever landing in the baseline.

    The scanned file set comes from `SECRETS_EXCLUDE_RE`, shared with the pre-commit
    hook; scanning anything that hook skips produces baseline churn nothing ever
    settles.
    """
    if (missing := absent()) is not None:
        return missing

    exclude = f'--exclude-files "{SECRETS_EXCLUDE_RE}"'
    baseline = root / ".secrets.baseline"

    if not baseline.exists():
        out, _ = run(f"detect-secrets scan {exclude}")
        baseline.write_text("\n".join(out), encoding="utf-8", newline="\n")
        return {"detect-secrets": ([], 0)}

    # Bytes, not `read_text`: detect-secrets writes the baseline in text mode, so on
    # Windows every scan left it CRLF, and `read_text` translates CRLF -- the two reads
    # compared equal, nothing was restored, and the worktree showed `.secrets.baseline`
    # modified with an empty diff, which blocked `git merge` (3 of 4 fixer trees on
    # 2026-09-19). The file is `eol=lf`, so whatever survives this is written LF.
    before_bytes = baseline.read_bytes()
    before = before_bytes.decode("utf-8").replace("\r\n", "\n")
    out, code = run(f'detect-secrets scan --baseline ".secrets.baseline" {exclude}')
    if code != 0:
        # Keep the tool's own output ahead of the summary. Dropping it is what made an
        # absent detect-secrets -- the normal state of a fresh worktree -- read as a
        # lint failure: `get_skip_reason` had nothing left to classify once the shell's
        # "is not recognized" line, the one that says missing tool rather than broken
        # repo, was thrown away. A genuine scan failure needs the output just as much.
        return {"detect-secrets": ([*out, f"detect-secrets: scan failed (exit {code})"], 1)}
    after_bytes = baseline.read_bytes()
    after = after_bytes.decode("utf-8").replace("\r\n", "\n")

    if normalize(after) == normalize(before):
        if after_bytes != before_bytes:
            # Timestamp or line-ending churn only: restore so the checkout stays clean.
            baseline.write_bytes(before_bytes)
        return {"detect-secrets": ([], 0)}
    if refused := refusal(before, after):
        baseline.write_bytes(before_bytes)
        return {"detect-secrets": (refused, 1)}
    if after_bytes != after.encode("utf-8"):
        baseline.write_text(after, encoding="utf-8", newline="\n")
    report()
    return {"detect-secrets": ([], 0)}
