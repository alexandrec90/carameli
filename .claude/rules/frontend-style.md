---
description: Frontend helper ownership and derived-state conventions
paths:
  - frontend/src/**/*.ts
  - frontend/src/**/*.tsx
---

# Rule: Frontend Helper and State Patterns

- Shared helpers belong in `frontend/src/lib/` and are imported where needed.
  Do not redefine helpers like `formatDate`, `formatPhone`, `toE164`, or `normalizeX` locally across files.
- Prefer derived state (`useMemo` or inline expressions) over `useEffect` that only mirrors one `useState` into another.
- Catch blocks and promise `.catch(...)` handlers must log unexpected errors with `logger.error(...)`.
