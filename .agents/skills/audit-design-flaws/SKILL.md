---
name: audit-design-flaws
disable-model-invocation: true
description: 'Grep-based audit for systematic AI-generated design flaws (file bloat, hardcoded constants, naming inconsistency, ghost code, type erasure, state-sync useEffects, helper proliferation). Use periodically on a vibe-coded codebase to detect and prevent architectural decay. Source of truth: docs/Systematic AI-Generated Design Flaws.md.'
argument-hint: '(no arguments)'
---

# Skill: Audit AI-Generated Design Flaws

Detect the recurring anti-patterns LLMs accumulate over long sessions.
Each check is a one-shot grep — no file-reading loops, no investigation spirals.

> **Source of truth:** `docs/Systematic AI-Generated Design Flaws.md`. Re-read it
> first to pick up new entries the user added.

---

## Execution model

This skill accepts no arguments and always runs in a single flow:

1. Detect violations
2. Apply minimal fixes for each confirmed violation
3. Propagate prevention guardrails for checks that fired

---

## Step 1 — Read state

In parallel:

1. Read `docs/Systematic AI-Generated Design Flaws.md` (catalog of flaws to check).
2. Read `.claude/skills/audit-design-flaws/known-flaws.md` (per-flaw `Hits` /
   `Last seen` table — lets us spot recurring offenders).
3. Read `.claude/skills/audit-design-flaws/state.json` (incremental scan cache;
  create with an empty object if missing).

---

## State model

- `known-flaws.md` is the **canonical persistent history** for this skill.
  It tracks recurrence over time (`First seen`, `Last seen`, `Hits`, `Status`).
- `.claude/skills/audit-design-flaws/state.json` is the **canonical scan cache**
  used to avoid rescanning unchanged files.
- Do not duplicate recurrence history in `state.json`; keep history in
  `known-flaws.md` only.
- Always use `.claude/skills/state-tools/state-engine.py plan` to
  compare file signatures against `state.json`. Do not hand-derive diffs.
- Cache writes are automatic: the session `Stop` hook runs
  `scripts/hooks/finalize-state.py`, which calls `state-engine.py apply` and
  cleans up `scan-plan.json` / `scan-results.json`. Do not run `apply` by hand
  or hand-edit cache rows.
- `state.json` stores per-check metadata and per-file fingerprints, for example:

```json
{
  "checks": {
    "A": {
      "checkSignature": "<hash-of-check-logic>",
      "files": {
        "frontend/src/foo.tsx": {
          "contentHash": "<hash>",
          "lastScanned": "2026-04-27",
          "status": "pass|violation|fixed",
          "summary": "optional short note"
        }
      }
    }
  }
}
```

- Skip a file for a check only when **all** are true:
  1. `contentHash` unchanged
  2. `checkSignature` unchanged
  3. file was previously scanned for that check
- Force rescan when file changed, check logic changed, cache entry missing, or
  the file is newly created.

---

## Step 1.5 — Build incremental scan targets via script

Run the planner command below before continuing:

Suggested command (run in terminal):
```powershell
& { python .claude/skills/state-tools/state-engine.py plan --skill audit-design-flaws; if ($LASTEXITCODE -eq 0) { "scan-plan.json written" } else { "state-engine plan FAILED: exit $LASTEXITCODE" } }
```

Then use `.claude/skills/audit-design-flaws/scan-plan.json` as the source of truth:

- `checks.<id>.targets` => files to scan now
- `checks.<id>.skipped` => unchanged files to skip
- `checks.<id>.removed` => prune stale cache entries
- `checks.<id>.rebuildFacts` => recompute cross-file aggregates from cached +
  changed facts

---

## Step 2 — Run all checks in parallel

Each check below is a single grep / find. Run each check against its incremental
target set from Step 1.5 and collect every match as a violation row.
Skip files in: `node_modules/`, `.venv/`, `.git/`, `__pycache__/`, `dist/`, `build/`,
`alembic/versions/`, `tests/`, `.claude/`.

### Check A — File bloat ("One-File Gravitational Pull")

Flag Python source > **300 lines** and TS/TSX source > **250 lines**.

```bash
# Python
find app -name "*.py" -not -path "*/__pycache__/*" -exec wc -l {} + \
  | awk '$1 > 300 && $2 != "total" { print $0 }' | sort -rn

# TypeScript / TSX
find frontend/src -type f \( -name "*.ts" -o -name "*.tsx" \) \
  -not -path "*/node_modules/*" -not -path "*/tests/*" \
  -exec wc -l {} + | awk '$1 > 250 && $2 != "total" { print $0 }' | sort -rn
```

A match means the file likely mixes concerns and should be split.

### Check B — Hardcoded magic constants

Detect raw integer/string literals that should be constants. The classic case:
`const CUSTOMER_ID = 1` duplicated across hooks.

```bash
# Same constant repeated across files (likely shared concept, no central definition)
grep -rn --include="*.ts" --include="*.tsx" \
  -E "^\s*const\s+[A-Z_]+\s*=\s*[0-9]+" frontend/src \
  | sort -t= -k2 | uniq -f1 -d

# Hardcoded URLs / endpoints in source (not config)
grep -rn --include="*.py" --include="*.ts" --include="*.tsx" \
  -E "https?://(localhost|127\.0\.0\.1|[a-z0-9.-]+\.(com|net|io|org))" \
  app/ frontend/src/ | grep -v -E "(\.env\.example|config\.py|test_|\.test\.)"
```

Two or more files defining the same `const NAME = literal` ⇒ extract to a shared
constants module (`frontend/src/lib/constants.ts` or `app/core/constants.py`).

### Check C — Naming inconsistency ("Context Window Amnesia")

The same concept exposed under both snake_case and camelCase, often within the
same file, indicates a session-boundary slip.

```bash
# Frontend: hooks pass customerId / customer_id / vs_customer_id for the same value.
# Flag any file that uses two or more of these tokens.
for f in $(grep -lr --include="*.ts" --include="*.tsx" \
    -E "(customerId|customer_id|vs_customer_id)" frontend/src); do
  styles=$(grep -E -o "(customerId|customer_id|vs_customer_id)" "$f" | sort -u | wc -l)
  [ "$styles" -ge 2 ] && echo "MIXED $f: $(grep -E -o '(customerId|customer_id|vs_customer_id)' \"$f\" | sort -u | tr '\n' ' ')"
done
```

A match means the API contract is drifting between layers. Pick one style per
boundary (DB columns = snake_case, JS local vars = camelCase, JSON wire = whatever
the route expects) and convert the rest.

### Check D — Helper function proliferation

Same helper function name defined in multiple files instead of being centralized.

```bash
# TS / TSX
grep -rEn --include="*.ts" --include="*.tsx" \
  "^\s*(function|const)\s+(formatDate|formatPhone|formatNumber|validateEmail|validateInput|parseDate|toE164|normalize[A-Z]\w+)" \
  frontend/src | awk -F: '{print $3}' | sort | uniq -c | awk '$1 > 1'

# Python
grep -rEn --include="*.py" \
  "^\s*def\s+(format_date|format_phone|validate_email|to_e164|normalize_\w+)" \
  app | awk -F: '{print $3}' | sort | uniq -c | awk '$1 > 1'
```

Two or more definitions of the same helper ⇒ move to `frontend/src/lib/<area>.ts`
or `app/core/<area>.py`, import from there.

### Check E — Ghost code (stale TODO / FIXME / HACK / XXX)

```bash
grep -rEn --include="*.py" --include="*.ts" --include="*.tsx" \
  "(^|\s)(TODO|FIXME|HACK|XXX)([:(]|\s)" \
  app/ frontend/src/ | grep -v -E "(test_|\.test\.|\.spec\.)"
```

Each match is either a real follow-up (file an issue, link it in the comment) or
a dead note (delete it).

### Check F — Type erasure (TypeScript)

```bash
grep -rEn --include="*.ts" --include="*.tsx" \
  "(:\s*any\b|as\s+any\b|@ts-ignore|@ts-expect-error)" \
  frontend/src | grep -v -E "(\.test\.|\.spec\.|/tests/)"
```

Each match needs a real type or a one-line comment explaining the bypass.

### Check G — Silent exception swallowing

```bash
# Python: bare except: pass / except Exception: pass without logging
grep -rEn --include="*.py" -B0 -A1 \
  "except[^:]*:\s*$" app/ \
  | grep -A1 "except" | grep -B1 -E "^\s*(pass|continue|\.\.\.)$"

# TS: catch blocks with no body
grep -rEn --include="*.ts" --include="*.tsx" \
  "catch\s*(\([^)]*\))?\s*\{\s*\}" frontend/src

# TS: catch blocks that only chain (.catch(() => {}) etc.)
grep -rEn --include="*.ts" --include="*.tsx" \
  "\.catch\(\s*(\(\)|_)\s*=>\s*\{?\s*\}?\s*\)" frontend/src
```

Each match drops error context. Replace with `logger.error(...)` (backend) or
`logger.error(...)` from `frontend/src/lib/logger.ts`.

### Check H — Redundant `useEffect` (state syncing / derived-state)

A `useEffect` whose body just sets one state from another is a derived value.

```bash
# Files with 3+ useEffect calls — likely state-syncing soup
grep -rEn --include="*.ts" --include="*.tsx" "useEffect\(" frontend/src \
  | awk -F: '{print $1}' | sort | uniq -c | awk '$1 >= 3'
```

For each flagged file, read it and check whether any `useEffect` purely mirrors
state. If yes, replace with a derived `useMemo` or inline expression.

### Check I — Test fudging signals

```bash
# Tests that assert against literal values matching obvious bug-shapes:
# expect(x).toBe(undefined), expect(x).toBe(null), expect.any(Function) used as the only assertion
grep -rEn --include="*.test.ts" --include="*.spec.ts" --include="test_*.py" \
  "(toBe\(undefined\)|toBe\(null\)|toBe\(NaN\)|assert .* is None\b)" \
  frontend/src tests | head -30

# Skipped / xfail tests (often added to silence a failure rather than fix it)
grep -rEn --include="*.py" --include="*.ts" --include="*.tsx" \
  -E "(it\.skip|describe\.skip|@pytest\.mark\.skip|@pytest\.mark\.xfail|xit\(|xdescribe\()" \
  tests frontend/src
```

Each skipped/xfail case must have a linked issue or a one-line justification.
Loose `toBe(undefined)` checks often mean the test was relaxed to match buggy
output — re-derive the correct assertion from the spec.

### Check J — Mocking overload

```bash
# Tests where >50% of lines are mock setup
for f in $(find tests -name "test_*.py"); do
  total=$(wc -l < "$f")
  mocks=$(grep -cE "(MagicMock|AsyncMock|Mock\(\)|patch\(|monkeypatch)" "$f")
  [ "$total" -gt 0 ] && [ "$((mocks * 100 / total))" -gt 50 ] && \
    echo "MOCK-HEAVY $f ($mocks mocks / $total lines)"
done
```

A mock-heavy test is testing the mock, not the system. Carameli rule: mock at the
provider boundary only (`.claude/rules/voip-providers.md`).

### Check K — Coverage drift

Source modules with no corresponding test file.

```bash
# Backend: services / repos without a sibling test
for f in $(find app/services app/repositories -name "*.py" -not -name "__init__.py"); do
  base=$(basename "$f" .py)
  matches=$(grep -rl "$base" tests/unit tests/integration 2>/dev/null | wc -l)
  [ "$matches" -eq 0 ] && echo "NO-TEST $f"
done

# Frontend: hooks / lib without a sibling test
for f in $(find frontend/src/hooks frontend/src/lib -type f \( -name "*.ts" -o -name "*.tsx" \)); do
  base=$(basename "$f" | sed -E 's/\.(ts|tsx)$//')
  matches=$(find frontend/src/tests -name "${base}.test.*" 2>/dev/null | wc -l)
  [ "$matches" -eq 0 ] && echo "NO-TEST $f"
done
```

Each match needs at least a happy-path + one error-case test. Hand off to
`/make-tests` or `/make-frontend-tests`.

### Check L — Circular / fragile imports

```bash
# Python: relative parent imports (often a sign of unclear ownership)
grep -rEn --include="*.py" "^\s*from \.\.\.?" app

# TS: imports that walk up 3+ levels
grep -rEn --include="*.ts" --include="*.tsx" \
  -E "from\s+['\"](\.\.\/){3,}" frontend/src
```

Each match likely indicates a misplaced module — move it to a shared layer that
both sides can import from directly.

---

## Step 2.5 — Scale control (divide-and-conquer when needed)

- If total violations ≤ 25 **and** touched files ≤ 15, run in one session.
- If either threshold is exceeded, split execution into sequential batches:
  1. **Low-risk mechanical**: E, F, G, I, L
  2. **Medium refactor**: B, C, J, K
  3. **High-risk structural**: A, D, H (one module at a time)
- Per batch cap: max 10 files or one structural extraction.
- Enforcement is automatic via `scripts/hooks/enforce-audit-batch-caps.py` on
  `PreToolUse` for edit/write tools.
- When caps are required, the hook creates:
  - `.claude/skills/audit-design-flaws/batch-plan.json` (all capped batches)
  - `.claude/skills/audit-design-flaws/batch-active.json` (current batch pointer)
- Edit/write operations that touch files outside the active batch are blocked
  until `batch-active.json` points to the corresponding batch.
- After each batch: **do not re-run checks**. Apply fixes, update `state.json`
  fingerprints and set touched fixed entries to `status = fixed`, apply
  prevention updates for fired checks, and update `known-flaws.md`.

---

## Step 3 — Report

Emit one block per check. Format:

```text
## Design-Flaws Audit — YYYY-MM-DD

### Check A: File bloat
  PASS  no files over threshold.

  — or —

  VIOLATION  frontend/src/skins/comic-book/Layout.tsx  1036 lines (limit 250)
  VIOLATION  app/api/webhooks/call_status.py            306 lines (limit 300)

### Check B: Hardcoded magic constants
  VIOLATION  CUSTOMER_ID = 1 duplicated in:
    - frontend/src/hooks/usePhoneLines.ts:4
    - frontend/src/hooks/useExtensions.ts:4
    - frontend/src/hooks/useDashboard.ts:4 (named DEMO_CUSTOMER_ID)

[…repeat for every check…]

---
Summary:  X violations across Y / 12 checks.
Recurring offenders (≥3 hits across past audits): see known-flaws.md
```

Then update `.claude/skills/audit-design-flaws/known-flaws.md`:

| Flaw pattern | First seen | Last seen | Hits | Status |
|---|---|---|---|---|

Increment `Hits` and refresh `Last seen` on every match. Mark `Status = fixed`
once the fix is applied. Rows with `Status = fixed` and no recurrence in 6 audits
are pruned.

---

## Step 4 — Fix (mandatory)

For each violation, apply the **minimal** fix. Never reformat surrounding code.

| Check | Fix recipe |
|---|---|
| **A: File bloat** | Identify the largest logical chunk (helpers, sub-component, drawing routines). Extract to a sibling file. Update imports. Run `npx tsc --noEmit` (frontend) or `python -m py_compile` (backend) to verify. |
| **B: Hardcoded constants** | Create or extend `frontend/src/lib/constants.ts` / `app/core/constants.py`. Move the literal there. Replace each occurrence with the imported constant. |
| **C: Naming inconsistency** | Pick one style per layer boundary (DB = `snake_case`, JS local = `camelCase`, wire = match the route schema). Rename consistently within each layer. Never silently rename a wire field. |
| **D: Helper proliferation** | Move the canonical implementation to `frontend/src/lib/<area>.ts` or `app/core/<area>.py`. Delete duplicates. Update imports. |
| **E: Ghost code** | If the TODO references a real follow-up: file a GitHub issue, replace the comment with `# TODO(#nnn): <text>`. Otherwise delete. |
| **F: Type erasure** | Derive the real type from upstream. If upstream is genuinely unknown (3rd-party SDK), narrow with `unknown` + a runtime guard, not `any`. |
| **G: Silent exception** | Add `logger.error("…", exc_info=True)` (backend) or `logger.error(…, { error })` (frontend). Re-raise unless the call site explicitly handles the error. |
| **H: Redundant useEffect** | Replace the syncing `useEffect` with a derived `useMemo` or an inline expression. |
| **I: Test fudging** | Re-derive the expected value from the spec. If the test must remain skipped, add a one-line `# reason: <link>`. |
| **J: Mocking overload** | Move the mock to the provider boundary. Use the in-memory test session for DB-touching tests (savepoint pattern from `tests/conftest.py`). |
| **K: Coverage drift** | Hand off to `/make-tests` (backend) or `/make-frontend-tests` (frontend). Do not write tests inside this skill. |
| **L: Fragile imports** | Move the shared symbol to a higher-level module so both sides can do a flat import. |

After fixes, do **not** re-run checks in the same session. Write
`.claude/skills/audit-design-flaws/scan-results.json` with verdicts for scanned
targets. The `Stop` hook will detect both `scan-plan.json` and
`scan-results.json`, run `state-engine.py apply`, and remove both artifacts —
no manual command needed.

---

## Step 5 — Prevent (mandatory)

For every flaw category that fired this run, propagate a guardrail. Don't add a
guardrail for a check that didn't fire — keep the rule files lean.

### Guardrail propagation map

| Check fired | Update | Specifically add |
|---|---|---|
| **A: File bloat** | `.claude/rules/python-style.md` and per-skin rule files | A line: "Files over 300 lines (Py) / 250 lines (TSX) must be split before commit." |
| **B: Hardcoded constants** | `frontend/CLAUDE.md` and `.claude/rules/python-style.md` | A line: "Shared literals live in `lib/constants.ts` / `app/core/constants.py`. Never duplicate." |
| **C: Naming inconsistency** | New rule file `.claude/rules/naming.md` (create if missing) | A short table: layer → casing convention. |
| **D: Helper proliferation** | `.claude/rules/python-style.md` (Python section) and a new `.claude/rules/frontend-style.md` (TS) | A line per language: "Shared helpers live under `lib/`. Don't redefine `formatDate`/`toE164` locally." |
| **E: Ghost code** | `.claude/rules/python-style.md` | A line: "TODO comments must reference a tracker ID. Untracked TODOs are deleted in audit." |
| **F: Type erasure** | New `.claude/rules/frontend-style.md` | A line: "No `any`, `as any`, or `@ts-ignore` outside of test files." |
| **G: Silent exception** | Already covered by `.claude/rules/logging-backend.md` and `logging-frontend.md` — add the new offender pattern to the `check-logging` skill's grep list, not a new rule. |
| **H: Redundant useEffect** | New `.claude/rules/frontend-style.md` | A line: "Prefer derived state (`useMemo` / inline) over `useEffect`-based syncing between two `useState`s." |
| **I: Test fudging** | `.claude/rules/testing.md` | A line: "Skipped/xfail tests need a linked issue. Test failures are fixed in the code, not in the assertion." |
| **J: Mocking overload** | Already covered by `.claude/rules/voip-providers.md` (mock at provider boundary). Reinforce in `.claude/rules/testing.md` if the offending file mocked something other than a provider. |
| **K: Coverage drift** | No rule update — just the audit cadence. Add the offending module to `.claude/skills/make-tests/state.json` if that skill tracks targets. |
| **L: Fragile imports** | `.claude/rules/python-style.md` | A line: "No relative imports beyond one parent (`from ..foo`). Use absolute imports rooted at `app.`." |

### How to update files

- Use `Edit` (never `Write`) on existing rule / CLAUDE.md files. Append to the
  existing section, don't rewrite the file.
- For brand-new rule files (`naming.md`, `frontend-style.md`), create a minimal
  file with YAML frontmatter (see `.claude/rules/authoring.md`) and the relevant
  rule.
- After updating any `.claude/skills/` SKILL.md, re-check it stays under 500
  lines per the authoring rule.
- After adding a new rule file, update the cross-reference list in the root
  `CLAUDE.md` "Cross-cutting rules" section so it's discoverable.

### Update the catalog

Append the newly enforced guardrail as a "Mitigation" column in
`docs/Systematic AI-Generated Design Flaws.md` so the source of truth tracks
what is now enforced. Format:

```markdown
* **The "One-File" Gravitational Pull:** … (Mitigation: line cap in `.claude/rules/python-style.md`, audited by `audit-design-flaws` Check A.)
```

---

## Hard Rules

1. No mode switches: always run detect → fix → prevent.
2. Fixes only touch files with confirmed violations from this run — no
  pre-emptive refactors, no drive-by cleanup.
3. Prevention updates only target checks that **actually fired**. Don't pad
  rule files with guardrails for hypothetical flaws.
4. One violation = one minimal fix. Splitting a 1000-line file is one fix; do
   not also rename functions, change types, or "improve" the new files.
5. Never silently rename a wire field (route path, JSON key) — that breaks the
   contract with VanillaSoft. Naming fixes are layer-internal only.
6. Never delete a TODO without confirming with the user that no follow-up is
   needed.
7. After every run, update `known-flaws.md` even if no violations fired
   (refresh the "Last audit" timestamp at the bottom).
8. For large audits, batch by Step 2.5. Do not attempt broad structural and
  low-risk mechanical fixes in one giant edit burst.
9. `state.json` is persistent and used to skip unchanged files. Do not clear it
   at run end.
10. No same-run rechecks: verdicts come from the first pass; fixed entries are
  recorded as fixed immediately.
11. Cache updates are hook-driven via the session `Stop` hook +
    `finalize-state.py`; never hand-edit per-file cache records or invoke
    `apply` manually.
