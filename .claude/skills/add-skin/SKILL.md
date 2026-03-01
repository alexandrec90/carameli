# Skill: Add a New Skin

Use this skill when scaffolding a new skin from scratch.
Replace every occurrence of `<name>` with the skin's lowercase identifier (e.g. `candy-shop`).
Replace `<Name>` with the PascalCase version (e.g. `CandyShop`).

---

## Step 1 — Read the design brief

The design brief lives in `skins/<name>.txt` (or `.md`).
Read it in full before writing any code. Every decision in the steps below
should reflect the brief's tech stack, color palette, and motion choices.

---

## Step 2 — Create the rule file

File: `.claude/rules/skin-<name>.md`

Use the template from `.claude/rules/skin-architecture.md` (lines 127–179).
Fill in every section from the design brief. Mandatory sections:

- `description` and `paths:` frontmatter (scope to `frontend/src/skins/<name>/**`)
- Tech stack / renderer
- Color palette table (every token with hex + role)
- Layout system
- Component patterns (Button, Card/Panel, at minimum)
- Typography
- Motion & animation
- Hard rules summary (numbered list of explicit "never do X" constraints)

The rule file is the agent's reference when building the skin — it must be complete enough
that no one needs to re-read the original brief.

---

## Step 3 — Scaffold the skin directory

Create these six files. Each is a minimal stub; fill in the skin-specific
implementation after the scaffold is in place.

### `frontend/src/skins/<name>/index.ts`

```ts
import type { Skin } from '../types'
import { Layout } from './Layout'
import Dashboard from './views/Dashboard'
import PhoneLines from './views/PhoneLines'
import Extensions from './views/Extensions'
import Placeholder from './views/Placeholder'

const skin: Skin = {
  Layout,
  views: { Dashboard, PhoneLines, Extensions, Placeholder },
}

export default skin
```

### `frontend/src/skins/<name>/Layout.tsx`

```tsx
import React from 'react'

export function Layout({ children }: { children: React.ReactNode }) {
  // TODO: implement skin chrome — nav, providers, wrappers
  // If this skin needs <Canvas>, <ThemeProvider>, etc., they go here.
  return <div>{children}</div>
}
```

### `frontend/src/skins/<name>/views/Dashboard.tsx`

```tsx
import type { UseDashboardResult } from '../../../hooks/useDashboard'

export default function Dashboard(_props: UseDashboardResult) {
  return <div>Dashboard — <name> skin</div>
}
```

### `frontend/src/skins/<name>/views/PhoneLines.tsx`

```tsx
import type { UsePhoneLinesResult } from '../../../hooks/usePhoneLines'

export default function PhoneLines(_props: UsePhoneLinesResult) {
  return <div>Phone Lines — <name> skin</div>
}
```

### `frontend/src/skins/<name>/views/Extensions.tsx`

```tsx
import type { UseExtensionsResult } from '../../../hooks/useExtensions'

export default function Extensions(_props: UseExtensionsResult) {
  return <div>Extensions — <name> skin</div>
}
```

### `frontend/src/skins/<name>/views/Placeholder.tsx`

```tsx
import type { PlaceholderProps } from '../../types'

export default function Placeholder({ title, description }: PlaceholderProps) {
  return (
    <div>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  )
}
```

---

## Step 4 — Register the skin

Edit `frontend/src/skins/registry.ts`. Two changes:

**1. Add to `SKIN_NAMES`:**
```ts
// before
export const SKIN_NAMES = ['carameli'] as const

// after
export const SKIN_NAMES = ['carameli', '<name>'] as const
```

**2. Add to `skinLoaders`:**
```ts
// before
export const skinLoaders: Record<SkinName, () => Promise<{ default: Skin }>> = {
  carameli: () => import('./carameli'),
}

// after
export const skinLoaders: Record<SkinName, () => Promise<{ default: Skin }>> = {
  carameli: () => import('./carameli'),
  '<name>': () => import('./<name>'),
}
```

TypeScript will error at build time if the new skin's views don't satisfy `SkinViews`.
Run `npm run build` (or `npm run typecheck`) inside `frontend/` to confirm.

---

## Step 5 — Update the design brief index

Edit `skins/README.md`. Add a row to the table:

```md
| `<name>.txt` | `.claude/rules/skin-<name>.md` | Ready |
```

---

## Step 6 — Verify the scaffold

```bash
cd frontend && npm run typecheck
```

Fix any TypeScript errors before implementing the actual UI. Common issues:

- Missing export from `index.ts`
- View component not accepting the correct hook result type as props
- `SkinName` type not updated (happens if `SKIN_NAMES` edit was missed)

---

## Step 7 — Implement the skin

Now build out `Layout.tsx` and the four views using the rule file as the spec.
Use the `add-ui-component` skill for individual components within this skin.

To preview the skin at runtime:
```ts
localStorage.setItem('skin', '<name>')
location.reload()
```

---

## Checklist

- [ ] Design brief read in full before writing any code
- [ ] `.claude/rules/skin-<name>.md` created with all required sections
- [ ] `frontend/src/skins/<name>/index.ts` created
- [ ] `frontend/src/skins/<name>/Layout.tsx` created
- [ ] `frontend/src/skins/<name>/views/Dashboard.tsx` created
- [ ] `frontend/src/skins/<name>/views/PhoneLines.tsx` created
- [ ] `frontend/src/skins/<name>/views/Extensions.tsx` created
- [ ] `frontend/src/skins/<name>/views/Placeholder.tsx` created
- [ ] `registry.ts` — skin added to `SKIN_NAMES`
- [ ] `registry.ts` — skin added to `skinLoaders`
- [ ] `skins/README.md` table updated
- [ ] `npm run typecheck` passes with no errors
