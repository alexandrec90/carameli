# Systematic AI-Generated Design Flaws (Audit Catalog)

Catalog of common anti-patterns and "lazy" behaviors LLMs exhibit during long-term
development. The `audit-design-flaws` skill reads this at Step 1 (taxonomy of what to
check) and appends `Mitigation:` notes here at Step 5 as guardrails are added. Each entry
maps to a Check (A–L) in `SKILL.md`. Add new flaw types here to extend the audit.

## 1. File & Structural Bloat

* **The "One-File" Gravitational Pull:** AI tends to append new logic to existing files to avoid the "effort" of creating new file paths and exports. (Mitigation: line caps enforced in `.claude/rules/python-style.md` and skin rule files; audited by Check A.)
  * *Symptom:* Files exceeding 300+ lines or containing logically disparate components/utilities.
* **Missing Abstraction Layers:** New features are written as raw logic inside components rather than being abstracted into Hooks, Services, or Utility modules.
* **Import/Export Spaghetti:** Circular dependencies created because the AI doesn't track the overall dependency graph of the project.

### 2. Logic & Architectural Shortcuts

* **The "Patchwork" Fix:** Adding `if/else` branches to handle edge cases instead of refactoring the core logic to naturally include those cases.
* **Helper Function Proliferation:** Creating local `formatDate()` or `validateInput()` functions inside five different files instead of centralizing them in a `utils/` folder. (Mitigation: shared helper ownership enforced in `.claude/rules/python-style.md` and `.claude/rules/frontend-style.md`; audited by Check D.)
* **"Cargo Cult" Coding:** Replicating a previous sub-optimal pattern found elsewhere in the codebase because the AI assumes it is the "project standard."
* **Happy-Path Bias:** Writing logic that works for the "ideal" input but lacks robust error boundaries, try/catch blocks, or loading states.

### 3. Testing & Validation Flaws

* **Test-Fudging:** Modifying existing test assertions to match a bug in the new code, rather than fixing the code to meet the original requirements. (Mitigation: `.claude/rules/testing.md` requires linked reasons for skipped/xfail tests and forbids assertion-softening as a fix; audited by Check I.)
* **Mocking Overload:** Over-mocking everything to make tests pass, which results in tests that pass perfectly but don't catch integration failures.
* **Coverage Drift:** Adding complex features without adding corresponding unit or integration tests, leading to "dark areas" in the codebase. (Mitigation: recurring module gaps are tracked via `make-tests` state + Check K audit cadence.)

### 4. State & Data Management

* **Prop-Drilling Hell:** Passing state through five layers of components because the AI is "too lazy" to implement a proper Context, Store, or Composition pattern.
* **State Syncing (Derived State):** Creating redundant `useEffect` hooks to sync two pieces of state that should have been a single derived value. (Mitigation: derived-state preference enforced in `.claude/rules/frontend-style.md`; audited by Check H.)
* **Stale Context:** Writing logic that relies on a specific state structure that has since changed, leading to "undefined" errors or silent failures.

### 5. Code Hygiene & Maintenance

* **Ghost Code:** Leaving unused variables, deprecated functions, or "TODO" comments that the AI never actually returns to finish. (Mitigation: tracker-linked TODO policy in `.claude/rules/python-style.md`; audited by Check E.)
* **Commentary Noise:** Adding verbose comments that explain *what* the code is doing (which is obvious) instead of *why* it is doing it.
* **Type Erasure (TypeScript):** Frequent use of `any`, `as any`, or `// @ts-ignore` to bypass complex type errors during a "time crunch."
* **Hardcoding:** Embedding API endpoints, IDs, or magic strings directly in logic instead of using constants or environment variables. (Mitigation: shared constants policy in `frontend/src/lib/constants.ts` and `app/core/constants.py`; audited by Check B.)

### 6. Context Window Amnesia

* **Inconsistent Interfaces:** Function `A` expects `{user_id}` but Function `B` (written in a later session) expects `{userId}`, leading to a fragmented API. (Mitigation: layer casing contracts in `.claude/rules/naming.md`; audited by Check C.)
* **Silent Exception Swallowing:** `except: pass`, empty `catch {}`, or `.catch(() => {})` hide failures and erase debugging context. (Mitigation: backend/frontend logging checks and `check-logging` frontend-catch detection; audited by Check G.)
* **Fragile Deep/Relative Imports:** Imports that walk too far up (`../../../`) or rely on brittle parent-relative chains signal unclear ownership. (Mitigation: import-boundary rules in `.claude/rules/python-style.md`; audited by Check L.)
* **Redundant Dependencies:** Re-installing or re-importing a library (e.g., `lodash`) when a native or already-installed alternative exists.
