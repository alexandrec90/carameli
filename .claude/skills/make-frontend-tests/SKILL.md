---
name: make-frontend-tests
disable-model-invocation: true
description: 'Generates missing Vitest tests for frontend hooks, API client, skin system, views, pages, and shared components. Use when adding new frontend modules or reviewing test coverage gaps.'
argument-hint: 'Optional: a file path to target (e.g., "frontend/src/hooks/useDashboard.ts"), or "review" to audit for gaps only'
---

# Skill: Make Frontend Tests

Write new Vitest tests or review existing tests and add what is missing.
Follows the skin architecture rules: hooks own data, views are pure props,
pages are thin orchestrators. Mocks R3F at the Canvas boundary for carameli
skin components — never tests WebGL rendering.

---

## Step 1 — Determine Mode

| Argument | Mode |
| --- | --- |
| No argument | **Full audit** — scan all frontend source files, identify gaps, generate tests |
| `review` | **Review only** — report gaps without writing files |
| A file path | **Targeted** — generate tests for that file only |

---

## Step 2 — Load State

Read `.claude/skills/make-frontend-tests/state.json`. It tracks which modules
have been covered and when. Each entry:

```json
{
  "module": "frontend/src/hooks/useDashboard.ts",
  "test_file": "frontend/src/tests/useDashboard.test.ts",
  "last_reviewed": "YYYY-MM-DD",
  "git_hash": "<sha of module at review time>",
  "gaps_found": 0
}
```

If the file does not exist, treat it as `{ "last_run": null, "modules": [] }`.

---

## Step 3 — Discover Source Modules

The harness preprocesses discovery: every first-party TypeScript source file
with its last-commit git hash. TSV columns: `lines<TAB>hash<TAB>path`.

Suggested command (run in terminal):
```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .claude/skills/state-tools/discover-files.ps1 -Roots frontend/src -Includes *.ts,*.tsx -ExcludeDirs node_modules,dist,__tests__ -ExcludeNames *.test.ts,*.test.tsx,*.spec.ts,*.spec.tsx -WithGitHash
```

Classify each file into a layer:

| Layer | Path pattern | Test strategy |
| --- | --- | --- |
| **Hooks** | `frontend/src/hooks/*.ts` | `renderHook` + mocked API client |
| **API client** | `frontend/src/api/client.ts` | Mocked `fetch` |
| **Logger** | `frontend/src/lib/logger.ts` | Mocked `fetch` + fake timers |
| **Skin system** | `frontend/src/skins/context.tsx`, `registry.ts`, `types.ts` | Provider render + mocked loaders |
| **Pages** | `frontend/src/pages/*.tsx` | Render with mocked hook + mocked skin |
| **Carameli views** | `frontend/src/skins/carameli/views/*.tsx` | Render with R3F mocked at Canvas boundary |
| **Candy Shop views** | `frontend/src/skins/candy-shop/views/*.tsx` | Standard React Testing Library render |
| **Shared components** | `frontend/src/components/*.tsx` | Standard React Testing Library render |
| **App** | `frontend/src/App.tsx`, `main.tsx` | Router integration test |

Triage (same rules as make-tests):

| Status | Condition | Action |
| --- | --- | --- |
| **SKIP** | In state.json, hash matches, gaps_found = 0 | Skip |
| **SKIP** | Hash column shows `UNCOMMITTED` and not explicitly targeted | Skip |
| **CHANGED** | In state.json but hash differs | Re-evaluate |
| **NEW** | Not in state.json and has at least one commit | Full pass |

In **targeted** mode, the session-skip rule is bypassed.

---

## Step 4 — Audit Each Module

For each module to process:

**4a. Read the source file.** Identify:

- Every exported function, hook, component, or type
- State transitions (useState, useEffect dependencies)
- API calls (fetch, client methods)
- Error handling paths (try/catch, error states)
- Conditional rendering branches

**4b. Read the existing test file** (if it exists). Map what is already covered.

**4c. Identify gaps.** A gap is any of:

**Hook gaps:**

- Untested initial state (loading, error, data all at default)
- Untested success path (API returns data, state updates)
- Untested error path (API throws, error state set)
- Untested user actions (add, delete, refresh triggers)
- Missing `act()` wrapper for state updates

**API client gaps:**

- Untested method (each exported function needs a success + error test)
- Missing test for non-200 response (should throw or return error)
- Missing test for network failure (fetch rejects)
- Untested request shape (correct URL, method, headers, body)

**Logger gaps:**

- Queue batching not tested (logs accumulate, flush after interval)
- Immediate flush on error-level log not tested
- Console output not tested
- Fetch failure in ship-to-backend not tested (should not throw)

**Skin system gaps:**

- `SkinProvider` initial load (shows fallback, then resolves skin)
- `useSkin()` outside provider (should throw or return null)
- `useSkinSwitcher()` persists to localStorage
- `resolveSkinName()` with invalid name falls back to default
- Dynamic import failure (skin chunk fails to load)

**View gaps (carameli — R3F):**

- Component renders without throwing when R3F is mocked
- Correct props forwarded to child Three.js elements
- Conditional branches render correct elements

**View gaps (candy-shop — DOM):**

- Component renders with given props
- Conditional rendering (empty state, loading state, data state)
- User interaction (click handlers fire, input updates state)

**Page gaps:**

- Page calls the correct hook
- Page passes hook result to the correct skin view
- Page renders without throwing

**Component gaps:**

- Each variant renders (e.g. Button `primary` vs `ghost`)
- Disabled state prevents click handler
- Props forwarded correctly

Output a gap list before writing anything:

```text
Module: frontend/src/hooks/useDashboard.ts  →  frontend/src/tests/useDashboard.test.ts
  GAP: initial loading state not tested
  GAP: API error sets error state
  GAP: seedDemoCustomer triggers refetch
```

In **review** mode, stop here and print the full gap report. Do not write files.

---

## Step 5 — Write Tests

**Vitest environment:** Tests must run under `happy-dom` (not `jsdom`). If `vitest.config.ts`
or `vite.config.ts` does not already set `test.environment = 'happy-dom'`, add it. If
`happy-dom` is not in `devDependencies`, add it — do not use `jsdom` as a substitute.

**CI command:** The CI-safe single-run command is `npm run test:run`. The `npm run test`
command opens watch mode and blocks in CI. Only use `npm run test:run` in scripts and task
instructions. Verify both script names exist in `package.json`; add `"test:run": "vitest run"`
if missing.

For each gap identified, append or create tests following the patterns in
[writing-conventions.md](writing-conventions.md). That file covers:

- Test file location and naming
- Standard imports
- Hook tests (renderHook + mocked API client)
- API client tests (mock global fetch)
- R3F component tests (mock at Canvas boundary, shared `r3f-mocks.ts`)
- Candy Shop / DOM view tests
- SkinProvider tests (mock registry loaders)
- Logger tests (mock fetch + fake timers)
- Page tests (verify hook-to-view wiring)
- Naming conventions and what NOT to do

---

## Step 6 — Update State

Write `.claude/skills/make-frontend-tests/state-updates.json` with processed
module rows:

```json
{
  "last_run": "YYYY-MM-DD",
  "modules": [
    {
      "module": "frontend/src/hooks/useDashboard.ts",
      "test_file": "frontend/src/tests/hooks/useDashboard.test.ts",
      "last_reviewed": "YYYY-MM-DD",
      "git_hash": "<sha-or-UNCOMMITTED>",
      "gaps_found": 0
    }
  ]
}
```

The skill's `Stop` hook detects `state-updates.json`, runs `state-engine.py
apply`, and removes the file. Do not run `apply` by hand.

---

## Step 7 — Report

Print a summary table:

```text
## Frontend Test Coverage Pass — YYYY-MM-DD

| Module | Test File | Gaps Found | Tests Added |
|--------|-----------|-----------|-------------|
| hooks/useDashboard.ts | tests/useDashboard.test.ts | 3 | 3 |
| api/client.ts | tests/client.test.ts | 5 | 5 |
| skins/context.tsx | tests/context.test.tsx | 4 | 4 |
| skins/carameli/views/Dashboard.tsx | tests/carameli-dashboard.test.tsx | 2 | 2 |

Total: X gaps found, Y tests added.
```

### Gap category breakdown

```text
| Category | Gaps |
|----------|------|
| Hook (state/API) | N |
| API client | N |
| Logger | N |
| Skin system | N |
| Carameli views (R3F) | N |
| Candy Shop views (DOM) | N |
| Pages | N |
| Components | N |
```

List any modules skipped (unchanged since last pass).
Note any test failures that were not resolved.

---

## Hard Rules

1. Mock R3F at the `Canvas` / drei boundary — never render actual WebGL.
2. Mock the API client at module level for hook tests — never mock internal hook state.
3. One module at a time — complete audit, then write, before moving on.
4. Never modify source files. If a gap requires a source change, report it instead.
5. In **review** mode, never write or modify any file.
6. Do not test type-only files (`types.ts`, type re-exports).
7. Shared R3F mock file (`r3f-mocks.ts`) is the only allowed cross-test utility — all other fixtures stay in the test file.
8. Views must be tested with prop injection only — never call hooks inside view tests.
