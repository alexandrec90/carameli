# Frontend

## Dev Server

Vite on `:5173`. Proxies `/vsapi`, `/vg`, `/health` to `localhost:8000`.

## Gotchas

- Shared literals must live in `frontend/src/lib/constants.ts` (never duplicate inline across hooks/components).
- **Cookie-based auth** — frontend authenticates via `/auth/session` (HttpOnly cookie), no API key in the JS bundle.
