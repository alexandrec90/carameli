# Frontend

## Dev Server

Vite on `:5173`. Proxies `/vsapi`, `/vg`, `/health` to `localhost:8000`.

## Gotchas

- **Hardcoded `CUSTOMER_ID = 1`** in all hooks — no multi-tenancy in the UI yet.
- **Cookie-based auth** — frontend authenticates via `/auth/session` (HttpOnly cookie), no API key in the JS bundle.
