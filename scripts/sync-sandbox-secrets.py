"""Push the sandbox-tier credentials from a local .env into the GitHub
`sandbox` environment, so .env stays the single source of truth.

The `.github/workflows/sandbox-tests.yml` job reads these as environment-scoped
secrets / variables. Rather than run a `gh secret set` by hand for each one
(and forget which changed), maintain them in .env and run this to reconcile.

  python scripts/sync-sandbox-secrets.py            # sync .env -> sandbox env
  python scripts/sync-sandbox-secrets.py --dry-run  # show the plan, touch nothing
  python scripts/sync-sandbox-secrets.py --run      # sync, then dispatch the workflow

Only keys that are present AND non-empty in .env are pushed; empty/missing keys
are skipped (never overwrite a real secret with a blank). Values are piped to
`gh` over stdin, never placed on argv, and never printed by this script.

Env secrets work on free private repos; the required-reviewer protection rule
does not (needs GitHub Pro/Team). This script only manages secrets/variables.
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ENV_FILE = REPO_ROOT / ".env"
DEFAULT_ENVIRONMENT = "sandbox"
WORKFLOW_NAME = "Sandbox Tests"

# Sensitive → GitHub environment *secrets* (masked, write-only).
SECRET_KEYS = (
    "TELNYX_API_KEY",
    "TELNYX_WEBHOOK_SECRET",
    "TELNYX_MESSAGING_PROFILE_ID",
    "TELNYX_TEST_FROM_NUMBER",
    "TELNYX_TEST_TO_NUMBER",
)
# Non-secret config → GitHub environment *variables* (visible in logs).
VAR_KEYS = ("TELNYX_WEBHOOK_BASE_URL",)


def parse_dotenv(text: str) -> dict[str, str]:
    """Parse KEY=VALUE lines. Ignores blanks/comments, strips an `export `
    prefix and a single layer of surrounding matching quotes."""
    out: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export ") :]
        key, _, value = line.partition("=")
        key = key.strip()
        if not key:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
            value = value[1:-1]
        out[key] = value
    return out


def plan_sync(
    values: dict[str, str],
    secret_keys: tuple[str, ...] = SECRET_KEYS,
    var_keys: tuple[str, ...] = VAR_KEYS,
) -> tuple[list[str], list[str], list[tuple[str, str]]]:
    """Split the desired keys into (secrets_to_set, vars_to_set, skipped).

    A key is skipped when absent from `values` or present but empty -- pushing a
    blank would clobber a real secret already stored in the environment.
    """
    secrets_to_set: list[str] = []
    vars_to_set: list[str] = []
    skipped: list[tuple[str, str]] = []
    for key in secret_keys:
        if values.get(key):
            secrets_to_set.append(key)
        else:
            skipped.append((key, "missing" if key not in values else "empty"))
    for key in var_keys:
        if values.get(key):
            vars_to_set.append(key)
        else:
            skipped.append((key, "missing" if key not in values else "empty"))
    return secrets_to_set, vars_to_set, skipped


def _resolve_repo() -> str:
    """The nameWithOwner of the repo `gh` is pointed at."""
    result = subprocess.run(
        ["gh", "repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def _gh_set(kind: str, name: str, value: str, environment: str, repo: str) -> None:
    """Set one secret or variable, feeding the value over stdin (never argv)."""
    cmd = ["gh", kind, "set", name, "--env", environment, "--repo", repo]
    subprocess.run(cmd, input=value, text=True, check=True)


def sync(
    env_file: Path,
    environment: str,
    repo: str,
    *,
    dry_run: bool,
) -> tuple[list[str], list[str], list[tuple[str, str]]]:
    """Reconcile the env_file's sandbox keys into the GitHub environment."""
    if not env_file.exists():
        raise FileNotFoundError(f"env file not found: {env_file}")
    values = parse_dotenv(env_file.read_text(encoding="utf-8"))
    secrets_to_set, vars_to_set, skipped = plan_sync(values)

    for key, reason in skipped:
        print(f"  skip   {key} ({reason})")
    for name in secrets_to_set:
        print(f"  secret {name} -> {environment}" + (" [dry-run]" if dry_run else ""))
        if not dry_run:
            _gh_set("secret", name, values[name], environment, repo)
    for name in vars_to_set:
        print(f"  var    {name} -> {environment}" + (" [dry-run]" if dry_run else ""))
        if not dry_run:
            _gh_set("variable", name, values[name], environment, repo)
    return secrets_to_set, vars_to_set, skipped


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV_FILE)
    parser.add_argument("--environment", default=DEFAULT_ENVIRONMENT)
    parser.add_argument("--repo", default=None, help="owner/name (default: gh's repo)")
    parser.add_argument("--dry-run", action="store_true", help="show plan, change nothing")
    parser.add_argument("--run", action="store_true", help="dispatch the workflow after sync")
    args = parser.parse_args(argv)

    try:
        repo = args.repo or _resolve_repo()
    except (subprocess.CalledProcessError, FileNotFoundError) as exc:
        print(f"error: could not resolve the GitHub repo via gh: {exc}", file=sys.stderr)
        print(
            "Is the GitHub CLI installed and authenticated? Try `gh auth status`.", file=sys.stderr
        )
        return 1

    print(f"Syncing {args.env_file.name} -> {repo} environment '{args.environment}'")
    try:
        secrets_to_set, _vars, _skipped = sync(
            args.env_file, args.environment, repo, dry_run=args.dry_run
        )
    except FileNotFoundError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except subprocess.CalledProcessError as exc:
        print(f"error: gh command failed (exit {exc.returncode}).", file=sys.stderr)
        return 1

    if not secrets_to_set:
        print(
            "\nNo secrets were set. TELNYX_API_KEY is required for the sandbox "
            "tests to run — set it in .env, then re-run.",
            file=sys.stderr,
        )

    if args.run and not args.dry_run:
        print(f"\nDispatching '{WORKFLOW_NAME}'...")
        try:
            subprocess.run(
                ["gh", "workflow", "run", WORKFLOW_NAME, "--repo", repo],
                check=True,
            )
            print("Dispatched. Watch it with:  gh run watch")
        except subprocess.CalledProcessError as exc:
            print(
                f"error: could not dispatch '{WORKFLOW_NAME}' (exit {exc.returncode}).\n"
                "A workflow_dispatch workflow is only runnable once its file is on\n"
                "the repo's DEFAULT branch. Commit and merge "
                ".github/workflows/sandbox-tests.yml\nto master, then re-run. "
                "(The secret sync above already succeeded.)",
                file=sys.stderr,
            )
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
