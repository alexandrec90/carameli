---
description: Carameli skin visual design conventions (3D canvas UI)
paths:
  - frontend/src/skins/carameli/**/*.ts
  - frontend/src/skins/carameli/**/*.tsx
---

# Rule: Carameli Skin — "Liquid Candy Maximalism"

> **Scope:** This rule applies only to the `carameli` skin (`frontend/src/skins/carameli/`).
> For the skin system architecture itself, see `.claude/rules/skin-architecture.md`.

The Carameli front-end is a **fully 3D interface rendered in React Three Fiber (R3F)**.
Think casual mobile game meets high-end confectionery — dense, hyper-textured, tactile.
Ignore minimalist trends. Every surface should look good enough to eat.

**Renderer:** `@react-three/fiber` + `@react-three/drei` + `@react-three/postprocessing`
**Motion:** `@react-spring/three` (springs only — no CSS transitions, no linear lerp)

---

## Color Palette

| Token | Hex | Role |
| --- | --- | --- |
| `deep-base` | `#1A0800` | Scene fog, void fill |
| `caramel-core` | `#C8640A` | Primary extrusion, drip geometry |
| `golden-gloss` | `#FF9F1C` | Panel base color |
| `amber-highlight` | `#FFD275` | Specular highlights |
| `burnt-shadow` | `#3D1A00` | Subsurface scatter deep color |
| `cream-white` | `#FFFDF5` | Text mesh, candy coating |
| `candy-pink` | `#FF6B9D` | Accent — badges, detail jewels |
| `licorice-black` | `#0D0500` | Panel edge bevels |

Colors are applied as `MeshPhysicalMaterial` properties — never as CSS on DOM elements.

---

## Scene Architecture

```jsx
<Canvas>
  ├── <SceneLighting />          — multiple warm point lights + ambient
  ├── <CaramelFluidBackground /> — high-viscosity fluid sim background plane
  ├── <PostProcessing />          — bloom, chromatic aberration, vignette
  └── <UI3DLayer>
        ├── <FloatingPanel />    — rounded polygon panel widgets
        ├── <ExtrudedText />     — 3D cursive mesh text
        ├── <CandyButton />      — squash-and-stretch pill buttons
        └── <DrippingEdge />     — per-panel caramel drip geometry
```

| Scene setting | Value |
| --- | --- |
| Fog color / near / far | `#1A0800`, `8`, `25` |
| Camera tilt | ~8° downward |
| Chromatic aberration offset | `[0.0008, 0.0008]` |

---

## Lighting

Minimum 3 colored point lights. Cold/white lights are forbidden.

| Type | Position | Intensity | Color | Notes |
| --- | --- | --- | --- | --- |
| `ambientLight` | — | `0.15` | `#FF9F1C` | Dim warm fill |
| `pointLight` | `[3, 6, 3]` | `4` | `#FFD275` | Key — top right, `castShadow` |
| `pointLight` | `[-4, 2, 1]` | `2` | `#FF6B3D` | Fill — left orange |
| `pointLight` | `[0, -2, 4]` | `1` | `#FF9F1C` | Rim — from below |
| `rectAreaLight` | `[0, 8, 0]` | `3` | `#FFF4DC` | Overhead soft box, `width/height: 10` |

---

## Materials

All primary surfaces use `meshPhysicalMaterial`. `meshBasicMaterial` and `meshStandardMaterial` are forbidden on any primary UI surface.

### "Caramel Gloss" — Panels

| Property | Value | Notes |
| --- | --- | --- |
| `color` | `#FF9F1C` | golden-gloss |
| `roughness` | `0.05` | near-mirror |
| `metalness` | `0.0` | |
| `transmission` | `0.15` | slight internal glow |
| `thickness` | `1.2` | IOR depth |
| `ior` | `1.52` | glass-like |
| `reflectivity` | `0.9` | |
| `clearcoat` | `1.0` | candy shell |
| `clearcoatRoughness` | `0.02` | |
| `envMapIntensity` | `2.5` | |
| `sheen` | `0.4` | |
| `sheenColor` | `#FFD275` | satin on curved edges |

### "Cream Coat" — Text Mesh

| Property | Value |
| --- | --- |
| `color` | `#FFFDF5` |
| `roughness` | `0.08` |
| `metalness` | `0.0` |
| `transmission` | `0.08` |
| `clearcoat` | `1.0` |
| `clearcoatRoughness` | `0.01` |
| `envMapIntensity` | `3.0` |
| `thickness` | `0.4` |

### "Molten Drip" — Drip Geometry

| Property | Value | Notes |
| --- | --- | --- |
| `color` | `#C8640A` | caramel-core |
| `roughness` | `0.12` | |
| `transmission` | `0.25` | semi-translucent |
| `thickness` | `0.8` | |
| `ior` | `1.46` | |
| `clearcoat` | `0.8` | |
| `clearcoatRoughness` | `0.05` | |

---

## 3D Text

All primary text uses `<Text3D>` from drei. Small functional labels may use flat `<Text>`.

| Property | Value | Notes |
| --- | --- | --- |
| `font` | `/fonts/Pacifico_Regular.json` | Rounded script — never geometric sans |
| `height` | `≥ 0.28` | Flat text is forbidden |
| `curveSegments` | `32` | Smooth curves |
| `bevelEnabled` | `true` | Always |
| `bevelThickness` | `0.06` | |
| `bevelSize` | `0.04` | |
| `bevelSegments` | `12` | |

### Typography scale

| Usage | `height` | `bevelThickness` |
| --- | --- | --- |
| Headlines | `0.28` | `0.06` |
| Sub-headings | `0.18` | `0.04` |
| Numbers / counters | `0.22` | `0.05` |
| Body / labels | flat `<Text>` | n/a |

---

## Panels

Panels use `<RoundedBox>` — no flat planes.

| Property | Value | Notes |
| --- | --- | --- |
| Depth (z) | `≥ 0.18` | Zero-depth looks like CSS divs |
| `radius` | `≥ 0.14` | |
| `smoothness` | `8` | |
| Drips | 4–8 per panel | Procedural teardrop meshes along bottom edge |

Drips use "Molten Drip" material. They hang 0.1–0.5 units, randomly spaced, and animate with slow sway and scale pulse.

---

## Fluid Background

Subdivided plane with a custom vertex shader simulating slow viscous fluid.

| Parameter | Value |
| --- | --- |
| Wave frequency | 0.3–0.6 Hz |
| Wave layers | ≥ 3 overlapping sine waves at different angles |
| Color blend | `#1A0800` → `#C8640A` by surface height |
| Plane subdivisions | `128×128` |
| Position / rotation | `[0, -1.5, 0]`, rotated `[-π/2, 0, 0]` |

Fluid moves at all times — never static. Normals recalculated per-frame. UI elements sit 0.5–2 units above the surface.

---

## Animation

All motion uses `@react-spring/three`. No CSS transitions, no `useFrame` linear lerp for interactive states.

### Button squash-and-stretch

| State | Scale | Tension | Friction |
| --- | --- | --- | --- |
| Hover | `[1.04, 1.04, 1.04]` | `200` | `20` |
| Press | `[1.0, 0.82, 1.0]` | `600` | `12` |
| Release | `[1, 1, 1]` | `600` | `12` |

Press uses asymmetric Y-axis squash — never uniform scale.

### Universal bob (every floating element)

| Parameter | Value |
| --- | --- |
| Frequency | 0.5–0.7 Hz |
| Y amplitude | 0.05–0.08 units |
| Rotation amplitude | < 0.015 rad |
| Phase stagger | unique offset per sibling |

Siblings never bob in unison.

### Drip sway

| Parameter | Value |
| --- | --- |
| Rotation frequency | ~0.3 Hz |
| Scale pulse amplitude | ±0.04 |
| Phase stagger per drip | 1.1 |

---

## Buttons

| Property | Value |
| --- | --- |
| Geometry | `CapsuleGeometry` |
| Radius | `0.18` |
| Length | `0.8` |
| Cap segments | `8` |
| Radial segments | `24` |
| Label | Flat `<Text>` billboard, cream-white, rounded font |
| Material | Caramel Gloss (candy-pink or golden tint per state) |

---

## Post-Processing

Always on in every scene.

| Effect | Property | Value |
| --- | --- | --- |
| `Bloom` | `intensity` | `0.7` |
| `Bloom` | `luminanceThreshold` | `0.82` |
| `Bloom` | `luminanceSmoothing` | `0.9` |
| `Bloom` | `mipmapBlur` | `true` |
| `ChromaticAberration` | `offset` | `[0.0006, 0.0008]` |
| `Vignette` | `offset` | `0.4` |
| `Vignette` | `darkness` | `0.7` |

---

## HDR Environment

Warm studio/sunset preset (`Environment preset="sunset"` or custom warm `.hdr`). `envMapIntensity` on all materials: 2.0–3.5.

---

## Hard Rules Summary

1. **Entire UI in `<Canvas>`** — no CSS-styled DOM for primary surfaces
2. **`meshPhysicalMaterial` everywhere** — `meshBasicMaterial`/`meshStandardMaterial` forbidden
3. **Real panel depth** — `RoundedBox` depth ≥ `0.18`, radius ≥ `0.14`
4. **3D extruded text** — `Text3D` with `bevelEnabled`, `height ≥ 0.2`; flat `<Text>` for small labels only
5. **Script/cursive font** — no geometric sans on headings
6. **Squash-and-stretch buttons** — asymmetric Y-scale squash on press
7. **Universal bob** — sinusoidal Y bob 0.5–0.7 Hz, siblings staggered
8. **Drips on every panel** — 4–8 procedural drips along bottom edge
9. **Warm lights only** — minimum 3 colored point lights, no cold/white
10. **Fluid background always moving** — vertex-shader fluid, never static
11. **Post-processing always on** — Bloom + ChromaticAberration + Vignette
12. **Spring physics for all motion** — no CSS transitions, no linear lerp
13. **HDR environment map** — warm preset, `envMapIntensity ≥ 2.0`
14. **Ignore minimalism** — dense, layered, textured
