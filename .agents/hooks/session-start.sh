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
echo "[session-start] Installing Python toolchain into .venv (runtime + dev linters)..."
[ -d .venv ] || python3 -m venv .venv
./.venv/bin/python -m pip install --quiet --disable-pip-version-check --upgrade pip \
  || echo "[session-start] WARN: pip self-upgrade failed"
./.venv/bin/python -m pip install --quiet --disable-pip-version-check \
  -r requirements.txt -r requirements-dev.txt \
  || echo "[session-start] WARN: pip install failed — ruff/mypy/pytest may be unavailable"

# Persist the venv on PATH for every turn, so bare ruff/pytest/python resolve to
# it (not only under lint-all.py's internal PATH shim).
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export PATH=\"${CLAUDE_PROJECT_DIR:-.}/.venv/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi

echo "[session-start] Installing frontend toolchain (eslint/stylelint/tsc)..."
# npm install (not ci) so a warm cached container reuses node_modules.
npm install --prefix frontend --no-audit --no-fund \
  || echo "[session-start] WARN: npm install failed — frontend linters may be unavailable"

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
