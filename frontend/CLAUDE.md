# Frontend

## Build & Dev

- Dev server: `npm run dev` (Vite on `:5173`, proxies `/vsapi`, `/vg`, `/health` to `localhost:8000`)
- Build: `npm run build` (`tsc && vite build`)
- Tests: `npm run test` (`vitest run`, jsdom environment)
- Lint: `npm run lint` (ESLint flat config + TypeScript)

TypeScript is in strict mode (`noUnusedLocals`, `noUnusedParameters`).

## Architecture

```text
pages/        →  hooks/        →  api/client.ts  →  Backend
  ↓
skins/views/  ←  (props)
```

- **hooks/** — Data layer. One hook per page, returns a typed result object. No JSX.
- **pages/** — Thin orchestrators: call hook, call `useSkin()`, pass props to the skin's view.
- **skins/** — Pluggable visual themes, loaded via dynamic import (Vite code-splitting).
  Each skin has its own `Layout.tsx` and `views/` directory. Views are pure (props only, no API calls).
- **api/client.ts** — Centralized fetch client with cookie auth (`credentials: 'include'`) and typed request/response objects.
- **components/** — Shared skin-agnostic UI (Button, Card, SkinSwitcher).
- **lib/logger.ts** — Batched frontend logging shipped to `/vg/1.0.0/frontend-logs` every 2 s (errors flush immediately).

## Skin System

- `SkinProvider` in `skins/context.tsx` loads the active skin on mount from `localStorage` (default: `carameli`).
- `skinLoaders` in `skins/registry.ts` maps skin names to dynamic imports — each skin is its own Vite chunk.
- `useSkin()` returns the loaded `Skin` object; `useSkinSwitcher()` provides the toggle.
- Three.js deps (`three`, `@react-three/fiber`, `@react-spring/three`) are only loaded when the `carameli` skin is active.

## Gotchas

- **Hardcoded `CUSTOMER_ID = 1`** in all hooks — no multi-tenancy in the UI yet.
- **Cookie-based auth** — frontend authenticates via `/auth/session` (HttpOnly cookie), no API key in the JS bundle.
- **Google Fonts preloaded** in `index.html` (Outfit, Inter, Lobster) to avoid FOUT.
- **CSS design tokens** defined as `:root` variables in `index.css`, consumed by Tailwind and inline styles.
- **ESLint uses flat config** (`eslint.config.js`), not legacy `.eslintrc`.

## Testing

Vitest with `@testing-library/react` and jsdom. Currently minimal (smoke test only).
Test files go in `src/tests/`.
