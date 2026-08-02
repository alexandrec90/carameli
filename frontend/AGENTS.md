# Frontend

Vite serves on `:5173` and proxies `/vsapi`, `/vg`, and `/health` to the backend.
Browser authentication uses the HttpOnly session cookie from `/auth/session`; never put
an API key or provider credential in the bundle.

- Hooks own API access and state. Pages select a hook and a skin view. Skins render the
  supplied data and must not fetch it themselves.
- Shared helpers/constants belong in `src/lib/`; do not duplicate formatters or wire
  literals across hooks/components.
- Keep frontend variables `camelCase`; map external wire shapes explicitly at the API
  boundary.
- Prefer derived values over effects that mirror state.
- Use `src/lib/logger.ts` for unexpected states and caught failures. It already batches
  authenticated entries to `/vg/1.0.0/frontend-logs`; never log secrets or message bodies.
- Follow `.claude/rules/skin-architecture.md` and the active skin's scoped rule for skin
  work. Use the `add-skin` skill only when creating an entirely new skin.

Verify frontend changes with `npm run test:run` and `npm run typecheck` from this
directory.
