---
name: add-ui-component
disable-model-invocation: true
description: 'Builds a Carameli 3D UI component using React Three Fiber conventions. Use when adding a new interactive element (button, card, modal, nav) to the carameli skin canvas.'
argument-hint: 'Component type or purpose (e.g., "stats card", "cta button")'
---

# Skill: Add a UI Component

All UI is rendered inside a React Three Fiber `<Canvas>`. No CSS-styled DOM panels for
primary surfaces. Every component is a 3D mesh.

---

## Step 1 — Identify the Component Type

| Request | R3F Pattern | Template |
|---|---|---|
| Button / call-to-action | Caramel Pill (`CapsuleGeometry` + squash-and-stretch spring) | `templates/CandyButton.tsx` |
| Data card / stat panel | Candy Tile (`RoundedBox` + caramel drips + bob animation) | `templates/CandyTile.tsx` |
| Drip decoration | Procedural capsule drips along panel bottom edge | `templates/DrippingEdge.tsx` |
| Heading / logo text | `Text3D` with script font, beveled, Cream Coat material | `templates/CandyHeadline.tsx` |
| Form input / text field | Rounded slab (`RoundedBox`, thin depth) + flat `<Text>` label | — |
| Modal / overlay | Large Candy Tile centered in scene, dimmed background mesh | — |
| Navigation bar | Horizontal pill strip, `RoundedBox`, sticky at top of scene | — |
| Dashboard widget (gauge, counter, chart) | Candy Tile + animated value or instanced bar meshes | — |
| Background / environment | Caramel fluid shader plane + HDR environment | — |

Templates live in `.claude/skills/add-ui-component/templates/`. Read the relevant
template before writing any component code — copy and adapt, don't re-type from scratch.

Material presets (spread directly into `<meshPhysicalMaterial />`):

```ts
import { CARAMEL_GLOSS, CREAM_COAT, MOLTEN_DRIP, CANDY_ACCENT }
  from '.claude/skills/add-ui-component/material-presets'
```

Presets file: `.claude/skills/add-ui-component/material-presets.ts`

---

## Step 2 — Read the Design Rule

Always read `.claude/rules/skin-carameli.md` before writing any component code.
Key sections:

- **Materials Spec** — which `meshPhysicalMaterial` preset to use per surface type
- **Animation System** — spring configs for squash-and-stretch and bob
- **Panel Geometry** — `RoundedBox` args, drip child requirements
- **Lighting Setup** — confirm scene has the required 3+ warm point lights
- **Post-Processing** — confirm `EffectComposer` is present in the scene root

---

## Step 3 — Required Imports

```tsx
// Core
import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { RoundedBox, Text3D, Text, Center, Environment } from '@react-three/drei'
import { useSpring, animated } from '@react-spring/three'

// Post-processing (scene root only)
import { EffectComposer, Bloom, ChromaticAberration, Vignette } from '@react-three/postprocessing'
```

---

## Step 4 — Write the Component

Read the appropriate template from `templates/`, adapt it to the request, and place
the output file in `frontend/src/skins/carameli/` alongside its siblings.

---

## Step 5 — Pre-Publish Checklist

- [ ] `meshPhysicalMaterial` on all primary surfaces — no `meshStandardMaterial` or `meshBasicMaterial`
- [ ] Panel uses `RoundedBox` with `args[2] ≥ 0.18` (real depth) and `radius ≥ 0.14`
- [ ] Panel includes a `<DrippingEdge>` child with 4–8 drips
- [ ] Bob animation present via `useFrame` sine oscillation (0.5–0.7 Hz)
- [ ] Sibling panels have staggered `bobOffset` values (0, 0.8, 1.7, 2.5 …)
- [ ] Button uses asymmetric squash-and-stretch (`scale.y → 0.82` on press)
- [ ] Button hover is uniform scale lift (1.04) — distinct from press state
- [ ] Text headings use `Text3D` with `bevelEnabled`, `height ≥ 0.2`, script/rounded font
- [ ] Scene root has warm lighting: `ambientLight` + ≥ 3 colored `pointLight`s
- [ ] Scene root has `<Environment preset="sunset" />` (or warm HDR)
- [ ] Scene root has `EffectComposer` with Bloom + ChromaticAberration + Vignette
- [ ] Dashboard values animate from their starting state — spring interpolation, not static render
- [ ] No flat CSS panels — all surfaces are `<mesh>` or `<group>` inside `<Canvas>`
