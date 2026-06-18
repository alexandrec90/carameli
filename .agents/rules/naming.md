---
description: Layer-specific casing conventions for API/data naming
paths:
  - app/**/*.py
  - frontend/src/**/*.ts
  - frontend/src/**/*.tsx
---

# Rule: Naming by Layer Boundary

Use one naming style per layer and convert at boundaries only.

| Layer | Convention |
| --- | --- |
| Python / DB models / ORM fields | `snake_case` |
| Frontend local variables and function params | `camelCase` |
| JSON wire contract | Preserve route schema as-is; do not silently rename keys |

If a frontend module needs both wire and local styles, map explicitly at the edge and keep internals consistent.
