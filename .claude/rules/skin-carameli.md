---
description: Carameli skin visual design conventions (3D canvas UI)
paths:
  - frontend/src/skins/carameli/**/*.ts
  - frontend/src/skins/carameli/**/*.tsx
  - frontend/src/**/*.css
  - frontend/index.html
  - frontend/tailwind.config.js
---

# Rule: Carameli Skin — "Liquid Candy Maximalism"

> **Scope:** This rule applies only to the `carameli` skin (`frontend/src/skins/carameli/`).
> For the skin system architecture itself, see `.claude/rules/skin-architecture.md`.
> Other skins have their own rules and are not bound by this spec.

The Carameli front-end is a **fully 3D interface rendered in React Three Fiber (R3F)**.
The aesthetic is unabashedly maximalist: dense, hyper-textured, tactile, edible.
Think casual mobile game meets high-end confectionery brand — Candy Crush UI meets Willy Wonka's factory floor.
Ignore minimalist trends entirely. Every surface should look good enough to eat.

**Renderer:** `@react-three/fiber` + `@react-three/drei` + `@react-three/postprocessing`
**Physics (fluid/bob):** `@react-three/rapier` or custom spring animation via `@react-spring/three`

---

## Color Palette — "Confectionery Deep"

The palette stays in the caramel-amber family but is applied to 3D materials, not CSS.

| Token | Hex / Value | Role |
| --- | --- | --- |
| `deep-base` | `#1A0800` | Scene fog color, void fill |
| `caramel-core` | `#C8640A` | Primary extrusion color, drip geometry |
| `golden-gloss` | `#FF9F1C` | MeshPhysicalMaterial base color (panels) |
| `amber-highlight` | `#FFD275` | Specular highlights, gloss peaks |
| `burnt-shadow` | `#3D1A00` | Subsurface scatter deep color, underside of drips |
| `cream-white` | `#FFFDF5` | Text mesh color, candy coating |
| `candy-pink` | `#FF6B9D` | Accent — small detail jewels, notification badges |
| `licorice-black` | `#0D0500` | Panel edge bevels, deep shadow |

**Rule:** Colors are applied as `MeshPhysicalMaterial` properties — never as CSS on DOM elements. The entire UI lives in `<Canvas>`.

---

## Scene Architecture

```
<Canvas>
  ├── <SceneLighting />         — multiple warm point lights + ambient
  ├── <CaramelFluidBackground /> — high-viscosity fluid sim background plane
  ├── <PostProcessing />         — bloom, chromatic aberration, vignette
  └── <UI3DLayer>
        ├── <FloatingPanel />   — rounded polygon panel widgets
        ├── <ExtrudedText />    — 3D cursive mesh text
        ├── <CandyButton />    — squash-and-stretch pill buttons
        └── <DrippingEdge />   — per-panel caramel drip geometry
```

### Scene-Level Rules

- **Fog:** `<fog attach="fog" color="#1A0800" near={8} far={25} />` — depth falls into rich darkness
- **Camera:** slight downward tilt (~8°) gives a "looking at a table of candy" perspective
- **Global bloom:** `<Bloom intensity={0.6} luminanceThreshold={0.85} />` — only gloss peaks bloom
- **Chromatic aberration:** subtle `offset={[0.0008, 0.0008]}` at screen edges

---

## Lighting Setup — "Candy Shop Window"

Multiple warm point lights simulate light bouncing off wet caramel surfaces.

```tsx
// Required lights — never use a single ambient-only setup
<ambientLight intensity={0.15} color="#FF9F1C" />           // very dim warm fill
<pointLight position={[3, 6, 3]}  intensity={4} color="#FFD275" castShadow />  // key — top right warm
<pointLight position={[-4, 2, 1]} intensity={2} color="#FF6B3D" />             // fill — left orange
<pointLight position={[0, -2, 4]} intensity={1} color="#FF9F1C" />             // rim — from below
<rectAreaLight position={[0, 8, 0]} width={10} height={10} intensity={3} color="#FFF4DC" /> // overhead soft box
```

**Rule:** At least 3 colored point lights must be present. Cold/white lights are forbidden.

---

## Materials Spec

### "Caramel Gloss" — Panel Surface

```tsx
<meshPhysicalMaterial
  color="#FF9F1C"
  roughness={0.05}          // near-mirror gloss
  metalness={0.0}
  transmission={0.15}       // slight internal glow / translucency
  thickness={1.2}           // IOR depth for refraction
  ior={1.52}                // glass-like refractive index
  reflectivity={0.9}
  clearcoat={1.0}           // candy shell clear coat
  clearcoatRoughness={0.02}
  envMapIntensity={2.5}     // HDR reflection strength
  sheen={0.4}
  sheenColor="#FFD275"      // satin sheen on curved edges
/>
```

### "Cream Coat" — Text Mesh

```tsx
<meshPhysicalMaterial
  color="#FFFDF5"
  roughness={0.08}
  metalness={0.0}
  transmission={0.08}
  clearcoat={1.0}
  clearcoatRoughness={0.01}
  envMapIntensity={3.0}     // strong reflections on white
  thickness={0.4}
/>
```

### "Molten Drip" — Drip Geometry

```tsx
<meshPhysicalMaterial
  color="#C8640A"
  roughness={0.12}
  metalness={0.0}
  transmission={0.25}       // drips are semi-translucent
  thickness={0.8}
  ior={1.46}
  clearcoat={0.8}
  clearcoatRoughness={0.05}
/>
```

**Rule:** No `meshStandardMaterial` or `meshBasicMaterial` on any primary UI surface. All interactive surfaces use `meshPhysicalMaterial`.

---

## 3D Text — "Script Extrusion"

All text is rendered as 3D meshes via `<Text3D>` from drei using a rounded script/cursive font.

```tsx
import { Text3D, Center } from '@react-three/drei'

// Headline text
<Center>
  <Text3D
    font="/fonts/Pacifico_Regular.json"   // or any rounded script font converted to typeface.json
    size={0.8}
    height={0.28}              // extrusion depth — generous, not thin
    curveSegments={32}         // smooth curves
    bevelEnabled
    bevelThickness={0.06}
    bevelSize={0.04}
    bevelOffset={0}
    bevelSegments={12}
  >
    Carameli
    <meshPhysicalMaterial   // cream coat on main face
      color="#FFFDF5"
      roughness={0.08}
      clearcoat={1.0}
      envMapIntensity={3.0}
    />
  </Text3D>
</Center>
```

**Text Rules:**
- Font must be a rounded or script/cursive typeface — never a geometric sans on primary headings
- `height` (extrusion) is always ≥ `0.2` — flat text is forbidden
- `bevelEnabled: true` always — gives the candy-coated edge
- Text meshes participate in the fluid wash: they sit at `z: 0` so background fluid geometry can pass over them
- Secondary labels (small, functional) may use `<Text>` (flat billboard) from drei with cream-white color

---

## Panel Geometry — "Candy Tile"

Panels are `RoundedBox` geometries (from drei) with thick bevels, not flat planes.

```tsx
import { RoundedBox } from '@react-three/drei'

<RoundedBox
  args={[3.2, 2.0, 0.22]}   // width, height, depth — always give panels real depth
  radius={0.18}              // corner bevel radius — generous rounding
  smoothness={8}             // bevel smoothness segments
>
  <meshPhysicalMaterial ... />  // Caramel Gloss
</RoundedBox>
```

**Panel Depth Rule:** Panels must have a `depth` (z-thickness) of at least `0.18`. Zero-depth panels look like CSS divs. Minimum `radius={0.14}`.

### Dripping Caramel Edges

Every panel has a `<DrippingEdge>` child that renders procedural drip geometry along the bottom edge.

```tsx
// Drip geometry concept — build as custom BufferGeometry or use instanced teardrop meshes
// Drips hang from panel bottom, varying lengths (0.1 – 0.5 units), tapering to a point
// They use "Molten Drip" material
// Number of drips: 4–8 per panel, randomly spaced
// Drips animate: slow bob + slight sway on x-axis
```

---

## Caramel Fluid Background

The background is a subdivided plane with a custom vertex shader simulating slow viscous fluid.

```glsl
// Vertex shader key parameters:
// - Low frequency (0.3–0.6 Hz), high amplitude waves — thick fluid moves slowly
// - At least 3 overlapping sine waves at different angles to break regularity
// - Normals recalculated per-frame for accurate lighting
// - Color: deep base (#1A0800) blended with caramel core (#C8640A) based on surface height
```

```tsx
// Scene placement:
<mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.5, 0]}>
  <planeGeometry args={[30, 30, 128, 128]} />   // high subdivision for smooth waves
  <caramelFluidShaderMaterial />
</mesh>
```

**Rules:**
- Fluid moves at all times — it never stops
- Fluid surface must react to point lights (recalculate normals)
- UI elements (panels, text, buttons) sit ~0.5–2 units above the fluid surface
- The fluid wash can visually "lap at" the base of text meshes — panels should appear to float on the surface

---

## Animation System — "Squash & Stretch"

All motion uses spring physics. No CSS transitions, no linear keyframes.

**Library:** `@react-spring/three`

### Button Squash-and-Stretch

```tsx
import { useSpring, animated } from '@react-spring/three'

function CandyButton({ children, onClick }) {
  const [active, setActive] = useState(false)

  const spring = useSpring({
    scale: active ? [1.0, 0.82, 1.0] : [1, 1, 1],   // squash on press: compress Y, spread implied
    config: {
      tension: 600,
      friction: 12,      // fast snap in, bouncy release
    },
  })

  return (
    <animated.group
      scale={spring.scale}
      onPointerDown={() => setActive(true)}
      onPointerUp={() => { setActive(false); onClick?.() }}
    >
      {/* button geometry */}
    </animated.group>
  )
}
```

**Squash Rules:**
- Press: Y scale → `0.82`, held as long as pointer is down
- Release: spring back to `[1, 1, 1]` with bounce (`friction: 10–14`)
- Hover: gentle scale-up `[1.04, 1.04, 1.04]`, slow spring (`tension: 200, friction: 20`)
- Never use uniform scale for press — true squash requires asymmetric axis scaling

### Universal Bob Animation

Every floating element gets a gentle vertical bob. Use `useFrame` with sine oscillation, stagger siblings.

```tsx
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'

function BobGroup({ children, offset = 0 }) {
  const ref = useRef()

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() + offset
    ref.current.position.y = Math.sin(t * 0.6) * 0.06        // slow, low amplitude
    ref.current.rotation.z = Math.sin(t * 0.4 + 1.2) * 0.012 // very slight rock
  })

  return <group ref={ref}>{children}</group>
}

// Stagger siblings: offset={0}, offset={0.8}, offset={1.7}, offset={2.5} ...
```

**Bob Rules:**
- Frequency: `0.5–0.7 Hz` — thick liquid bobs slowly
- Y amplitude: `0.05–0.08` units
- Rotation amplitude: `< 0.015 rad` — tilt, not tumble
- Every sibling panel gets a unique phase offset so they don't bob in unison

### Drip Sway Animation

```tsx
useFrame(({ clock }) => {
  const t = clock.getElapsedTime()
  drips.forEach((drip, i) => {
    drip.rotation.z = Math.sin(t * 0.3 + i * 1.1) * 0.08   // slow pendulum
    drip.scale.y = 1 + Math.sin(t * 0.5 + i * 0.7) * 0.04  // slight elongation pulse
  })
})
```

---

## Button Design — "Caramel Pill"

```tsx
// Pill shape: use CapsuleGeometry or two hemispheres + cylinder
<CapsuleGeometry args={[0.18, 0.8, 8, 24]} />  // radius, length, cap segs, radial segs

// Material: Caramel Gloss with candy-pink or golden tint per state
// Label: flat <Text> billboard centered on button face, cream-white, rounded font
// Interaction: Squash & Stretch spring (see above)
// Ambient: bob animation (offset from parent panels)
```

---

## Post-Processing Stack

```tsx
import { EffectComposer, Bloom, ChromaticAberration, Vignette } from '@react-three/postprocessing'
import { BlendFunction } from 'postprocessing'

<EffectComposer>
  <Bloom
    intensity={0.7}
    luminanceThreshold={0.82}
    luminanceSmoothing={0.9}
    mipmapBlur
  />
  <ChromaticAberration
    blendFunction={BlendFunction.NORMAL}
    offset={[0.0006, 0.0008]}
  />
  <Vignette
    offset={0.4}
    darkness={0.7}
    blendFunction={BlendFunction.NORMAL}
  />
</EffectComposer>
```

---

## Typography Rules (3D)

| Usage | Font | 3D Height | Bevel |
| --- | --- | --- | --- |
| Headlines | Pacifico / Lobster / rounded script | `0.28` | `bevelThickness: 0.06` |
| Sub-headings | Same script, smaller | `0.18` | `bevelThickness: 0.04` |
| Body / labels | `<Text>` (flat billboard, cream) | flat | n/a |
| Numbers / counters | Script or chunky sans | `0.22` | `bevelThickness: 0.05` |

**Count-up numbers:** driven by `@react-spring/three` number interpolation, not JS `requestAnimationFrame`.

---

## HDR Environment

```tsx
import { Environment } from '@react-three/drei'

// Use a warm studio or candy-shop HDR preset
<Environment preset="sunset" />   // or load custom .hdr with warm orange tones
// envMapIntensity on all materials: 2.0–3.5
```

---

## Hard Rules Summary

1. **Entire UI is in `<Canvas>`** — no CSS-styled DOM elements for primary UI surfaces.
2. **MeshPhysicalMaterial everywhere** — `meshBasicMaterial`/`meshStandardMaterial` forbidden on primary surfaces.
3. **Real panel depth** — `RoundedBox` with z ≥ `0.18` and `radius ≥ 0.14`. No flat planes as UI panels.
4. **3D extruded text** — `Text3D` with `bevelEnabled`, `height ≥ 0.2`. Flat `<Text>` only for small labels.
5. **Script/cursive font** — rounded or script typeface on all headings. No geometric sans.
6. **Squash-and-stretch buttons** — asymmetric Y-scale squash on press (`scale.y → 0.82`), bouncy spring release.
7. **Universal bob** — every floating element uses sinusoidal Y bob at `0.5–0.7 Hz`. Siblings staggered.
8. **Drips on every panel** — 4–8 procedural caramel drips hang from each panel's bottom edge.
9. **Warm lights only** — minimum 3 colored point lights, no cold/white lights.
10. **Fluid background always moving** — vertex-shader caramel fluid, never static.
11. **Post-processing always on** — Bloom + ChromaticAberration + Vignette in every scene.
12. **Spring physics for all motion** — `@react-spring/three`; no CSS transitions, no `useFrame` linear lerp for interactive states.
13. **HDR environment map** — warm sunset/studio HDR, `envMapIntensity ≥ 2.0` on all materials.
14. **Ignore minimalism** — dense, layered, textured. More is more.
