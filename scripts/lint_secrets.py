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
    first, and this pass's own promise never to block the suite read as broken.

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


def hashes(text: str) -> set[tuple[str, str]]:
    """`(file, hashed_secret)` for every finding a baseline records; empty if unparsable."""
    try:
        data = json.loads(text)
    except ValueError:
        return set()
    return {
        (file, s.get("hashed_secret", ""))
        for file, secrets in (data.get("results") or {}).items()
        for s in secrets
    }


def report(before: str, after: str) -> None:
    """Say what a scan that really changed the baseline changed, for `git diff` review."""
    added = hashes(after) - hashes(before)
    if added:
        print(
            f"  [auto-fix] detect-secrets: {len(added)} new finding(s) added to "
            ".secrets.baseline -- review with: git diff .secrets.baseline"
        )
    else:
        print(
            "  [auto-fix] detect-secrets: baseline entries updated (removed/relocated)"
            " -- review with: git diff .secrets.baseline"
        )


def scan(root: Path, run: Run) -> Result:
    """Scan for secrets; auto-acknowledge new findings into the baseline.

    detect-secrets never blocks the suite -- real secrets surface in
    `git diff .secrets.baseline` for review. New findings are detected by whether
    `scan --baseline` actually changed the baseline's results (ignoring the
    `generated_at` timestamp, which churns every run and is restored when it is the
    only change), so a reported count always matches what `git diff` will show.
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
    if after_bytes != after.encode("utf-8"):
        baseline.write_text(after, encoding="utf-8", newline="\n")
    report(before, after)
    return {"detect-secrets": ([], 0)}
