---
description: Skin system architecture — decoupled layouts and data hooks
paths:
  - frontend/src/skins/**/*.ts
  - frontend/src/skins/**/*.tsx
  - frontend/src/hooks/**/*.ts
  - frontend/src/pages/**/*.tsx
  - frontend/src/App.tsx
  - frontend/src/main.tsx
---

# Rule: Skin Architecture

The frontend is split into three strictly separate layers. Never mix them.

## Layer 1 — Data hooks (`src/hooks/`)

One hook per page. Owns all state, API calls, and derived values. Returns a typed result object. **No JSX.**

```text
src/hooks/
  useDashboard.ts    → UseDashboardResult
  usePhoneLines.ts   → UsePhoneLinesResult
  useExtensions.ts   → UseExtensionsResult
```

**Rules:**

- Export a named `interface` for the return type (e.g. `UseDashboardResult`). This is the contract between logic and skin.
- Never import anything from `skins/` or `components/` in a hook.
- Never render JSX or use DOM refs in a hook.

## Layer 2 — Skins (`src/skins/`)

Each skin is a self-contained directory that exports a `Skin` object. Skins are loaded via **dynamic import** so Vite splits them into separate chunks at build time.

```text
src/skins/
  types.ts           # Skin / SkinViews interfaces — the shared contract
  registry.ts        # Dynamic import map (one entry per skin)
  context.tsx        # SkinProvider + useSkin() hook
  carameli/
    index.ts         # Skin entry point (chunk boundary for Vite)
    Layout.tsx       # Full-page chrome (nav, providers, etc.)
    views/
      Dashboard.tsx  # Receives UseDashboardResult as props — no API calls
      PhoneLines.tsx
      Extensions.tsx
      Placeholder.tsx
```

**Rules:**

- A skin's `index.ts` must be the **only** entry point. Never import individual view files from outside the skin.
- Skin views receive data **only via props** from their hook result type. No `useState`, no `useEffect`, no `fetch` inside a view.
- A skin's `Layout.tsx` owns its full provider tree. If the skin needs `<Canvas>`, `<ThemeProvider>`, etc., they go here — not in `App.tsx` or `main.tsx`.
- Heavy dependencies (Three.js, etc.) must only be imported **inside** the skin directory so they stay in that skin's chunk.
- The `SkinContext` loading fallback in `context.tsx` must be pure inline styles (no Tailwind, no skin-specific CSS) so it renders before any skin loads.

## Layer 3 — Pages (`src/pages/`)

Thin orchestrators. Each page file is ~5 lines: call the hook, get the skin, render.

```tsx
// pages/Dashboard.tsx — canonical pattern
import { useDashboard } from '../hooks/useDashboard'
import { useSkin } from '../skins/context'

export default function Dashboard() {
  const data = useDashboard()
  const { views } = useSkin()
  return <views.Dashboard {...data} />
}
```

**Rules:**

- Pages must not contain JSX beyond the single `return <views.X {...data} />` line.
- Pages must not import from `skins/carameli/` or any specific skin — always go through `useSkin()`.
- `Placeholder` pages pass static props: `<views.Placeholder title="..." description="..." />`.

## Per-Skin Coding Guidelines

Each skin has exactly one rule file named `.claude/rules/skin-<name>.md`. Claude Code loads it
automatically when working on files inside that skin's directory, based on the `paths:` frontmatter.

**Naming convention:** `.claude/rules/skin-<name>.md` → scoped to `frontend/src/skins/<name>/**`

| Skin | Rule file |
| --- | --- |
| `carameli` | `.claude/rules/skin-carameli.md` |
| _(next skin)_ | `.claude/rules/skin-<name>.md` |
