#!/bin/bash
# SessionStart hook — provisions the sandbox so `scripts/lint-all.py` and the
# pytest suites are runnable from turn one. Without this, a Claude Code on the
# web session boots without the pinned toolchain (no ruff/mypy/pytest, no
# frontend node_modules), so the full lint suite can only run in CI — surfacing
# lint drift one slow gate round at a time instead of in a single local pass.
#
# Synchronous + idempotent. Remote-only: local dev machines already have the
# venv + node_modules, and container state is cached after this completes, so
# re-runs are cheap (venv reused, pip/npm no-op when satisfied).
set -uo pipefail

# --- Keep this branch current with origin/master (once per session) ----------
# Parallel worktrees drift from master the longer their branches live; this
# rebases the checked-out branch onto origin/master at session start so each
# session begins current, with no manual command. It reuses scripts/git-sync.py
# (the same rebase the "Git: Sync Branch" VS Code task runs), which refuses a
# dirty tree and disables autostash — so it is a no-op whenever you have
# uncommitted work and never touches your edits. Runs in BOTH local and remote
# sessions, so it sits above the remote-only provisioning guard below. Wrapped
# so a failure can never abort the hook.
(
  cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
  branch="$(git branch --show-current 2>/dev/null)"
  # Nothing to do on master itself, or with detached HEAD.
  if [ -n "$branch" ] && [ "$branch" != "master" ]; then
    echo "[session-start] Syncing '$branch' onto origin/master (no-op if tree is dirty)..."
    if ! python3 scripts/git-sync.py; then
      # On conflicts git-sync leaves a rebase in progress. Auto-abort so the
      # session starts in a known-clean state; the manual VS Code task is the
      # place to resolve conflicts interactively (see README, Parallel Worktrees).
      rebase_merge="$(git rev-parse --git-path rebase-merge 2>/dev/null)"
      rebase_apply="$(git rev-parse --git-path rebase-apply 2>/dev/null)"
      if [ -d "$rebase_merge" ] || [ -d "$rebase_apply" ]; then
        git rebase --abort 2>/dev/null
        echo "[session-start] origin/master had conflicting changes — auto-sync aborted, branch left untouched. Run the 'Git: Sync Branch with origin/master' task to rebase and resolve."
      else
        echo "[session-start] Branch sync skipped (dirty tree or offline) — sync manually when ready."
      fi
    fi
  fi
) || true

# Only provision the remote (Claude Code on the web) sandbox; a no-op elsewhere.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# Install the Python toolchain into a project venv. A venv (rather than the
# system interpreter) avoids the Debian-managed-package conflict — pip refuses
# to upgrade distro-owned packages like PyYAML — and `scripts/lint-all.py`
# already prepends ./.venv/bin to PATH, so ruff/mypy/pytest resolve without any
# extra wiring. Match CI: runtime locks + dev linters together.
#
# uv (the same resolver that compiled the locks) does the heavy install — an
# order of magnitude faster than pip on a cold sandbox. One small pip install
# bootstraps uv at the version pinned in the dev lock, so the installer version
# is single-sourced from requirements-dev.txt rather than duplicated here.
echo "[session-start] Installing Python toolchain into .venv (runtime + dev linters)..."
[ -d .venv ] || python3 -m venv .venv
uv_version="$(sed -nE 's/^uv==([^ ;]+).*/\1/p' requirements-dev.txt | head -n 1)"
./.venv/bin/python -m pip install --quiet --disable-pip-version-check \
  "uv==${uv_version:?requirements-dev.txt has no uv pin}" \
  || echo "[session-start] WARN: uv bootstrap failed — dependency install may fail"
./.venv/bin/python -m uv pip install --quiet --python ./.venv/bin/python \
  -r requirements.txt -r requirements-dev.txt \
  || echo "[session-start] WARN: uv install failed — ruff/mypy/pytest may be unavailable"

# Persist the venv on PATH for every turn, so bare ruff/pytest/python resolve to
# it (not only under lint-all.py's internal PATH shim).
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"${CLAUDE_PROJECT_DIR:-.}/.venv/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi

echo "[session-start] Installing frontend toolchain (eslint/stylelint/tsc)..."
# npm install (not ci) so a warm cached container reuses node_modules. The
# container's npm may differ from the lockfile author's and rewrite lockfile
# metadata on install; that churn trips the stop hook's dirty-tree check on
# otherwise read-only sessions, so restore the lockfile if it was clean before.
LOCKFILE=frontend/package-lock.json
lockfile_was_clean=false
git diff --quiet -- "$LOCKFILE" 2>/dev/null && lockfile_was_clean=true
npm install --prefix frontend --no-audit --no-fund \
  || echo "[session-start] WARN: npm install failed — frontend linters may be unavailable"
if $lockfile_was_clean && ! git diff --quiet -- "$LOCKFILE" 2>/dev/null; then
  git checkout -- "$LOCKFILE" \
    && echo "[session-start] Restored $LOCKFILE (npm install metadata churn)"
fi

# External lint binaries lint-all.py shells out to, installed to a PATH dir so
# `shutil.which(...)` finds them. Best-effort: the runner skips a missing tool
# cleanly and CI installs them regardless, but having them here keeps a local
# `lint-all.py` run faithful to the gate. NB positional args:
# download-actionlint.bash takes [[VERSION] DIR], NOT a -b flag.
BIN_DIR=/usr/local/bin
[ -w "$BIN_DIR" ] || BIN_DIR="$HOME/.local/bin"
mkdir -p "$BIN_DIR"
if ! command -v actionlint >/dev/null 2>&1; then
  echo "[session-start] Installing actionlint -> $BIN_DIR..."
  curl -sSfL https://raw.githubusercontent.com/rhysd/actionlint/main/scripts/download-actionlint.bash \
    | bash -s -- latest "$BIN_DIR" \
    || echo "[session-start] WARN: actionlint install skipped"
fi
if ! command -v dotenv-linter >/dev/null 2>&1; then
  echo "[session-start] Installing dotenv-linter -> $BIN_DIR..."
  curl -sSfL https://raw.githubusercontent.com/dotenv-linter/dotenv-linter/master/install.sh \
    | sh -s -- -b "$BIN_DIR" \
    || echo "[session-start] WARN: dotenv-linter install skipped"
fi

echo "[session-start] Done. Run 'python scripts/lint-all.py' before pushing a gated branch."
