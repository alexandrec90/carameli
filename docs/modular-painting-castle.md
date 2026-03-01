# Carameli UI — 3D Candy Maximalism Rewrite

## Context

The current frontend is a 2D flat/glassmorphism UI built with Tailwind CSS and DOM components. The brief is to completely replace it with a maximalist 3D interface rendered entirely in React Three Fiber, following the "Liquid Candy Maximalism" design system defined in `.claude/rules/ui-design.md`. The information architecture is also being redesigned — the old 6-page sidebar layout is replaced with 5 immersive 3D scenes navigated via a floating 3D pill nav bar. The API client and logger layers are untouched.

---

## Information Architecture (Before → After)

| Old | New | Notes |
| --- | --- | --- |
| Dashboard | **Hub** | Radial formation of stat orbs, caramel fluid fills the scene |
| Phone Lines | **Network** | Phone Lines + Extensions merged into one dual-panel scene |
| Extensions | ↑ merged into Network | — |
| SMS | **Messages** | 3D styled placeholder + send panel |
| Call Events | **Activity** | 3D styled placeholder + future timeline |
| Settings | **Config** | 3D styled placeholder + toggle panels |

Navigation changes: sidebar (`w-64` DOM div) → horizontal floating 3D pill strip rendered inside `<Canvas>`.

---

## New File/Folder Structure

```text
frontend/src/
├── main.tsx                     (minimal change — keep logger, remove Outfit font import)
├── App.tsx                      (rewrite: Canvas wrapper + scene routing)
├── index.css                    (gut to canvas-only styles; no component CSS needed)
├── api/client.ts                (no change)
├── lib/logger.ts                (no change)
├── 3d/
│   ├── Scene.tsx                (Canvas + lights + fog + Environment + EffectComposer)
│   ├── backgrounds/
│   │   └── CaramelFluid.tsx     (subdivided plane + vertex shader GLSL)
│   ├── components/
│   │   ├── BobGroup.tsx         (useFrame sine-bob wrapper, accepts offset prop)
│   │   ├── CandyTile.tsx        (RoundedBox panel + DrippingEdge + bob)
│   │   ├── CandyButton.tsx      (CapsuleGeometry + squash-and-stretch spring)
│   │   ├── CandyHeadline.tsx    (Text3D from drei CDN font + bevel + CreamCoat material)
│   │   ├── DrippingEdge.tsx     (4–8 instanced capsule drips, sway animation)
│   │   ├── StatOrb.tsx          (floating sphere with count-up number label)
│   │   ├── CandyInput.tsx       (RoundedBox slab + HTML input overlay via drei <Html>)
│   │   └── FloatingNav.tsx      (horizontal pill strip, 5 links, in-scene RoundedBox)
│   └── pages/
│       ├── HubScene.tsx         (Dashboard: 4 StatOrbs in arc + headline)
│       ├── NetworkScene.tsx     (Phone Lines + Extensions: two CandyTile panels side by side)
│       ├── MessagesScene.tsx    (SMS: single CandyTile placeholder)
│       ├── ActivityScene.tsx    (Call Events: single CandyTile placeholder)
│       └── ConfigScene.tsx      (Settings: single CandyTile placeholder)
```

Files **deleted** (replaced entirely):

- `src/components/Button.tsx`
- `src/components/Card.tsx`
- `src/components/Layout.tsx`
- `src/pages/Dashboard.tsx`
- `src/pages/PhoneLines.tsx`
- `src/pages/Extensions.tsx`
- `src/pages/Placeholder.tsx`

---

## Implementation Phases

### Phase 1 — Dependencies & Config

**package.json** — add:

```json
"@react-spring/three": "^9.7.x",
"@react-three/postprocessing": "^2.16.x"
```

**index.html** — update `<title>` to "Carameli" and remove the Outfit/Inter Google Fonts link (font rendering moves entirely into R3F; we use `<Text>` from drei for flat labels and `Text3D` for 3D headings).

**index.css** — replace all component CSS with:

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body, #root { width: 100%; height: 100%; overflow: hidden; background: #1A0800; }
canvas { display: block; }
```

(The canvas fills the viewport. Nothing else needs styles.)

**tailwind.config.js** — remove the custom keyframes (they were for DOM animations; all animation is now in R3F). Keep Tailwind installed for the `<Html>` overlay elements (input fields) which still need a few utility classes.

---

### Phase 2 — Scene Infrastructure

**`src/3d/Scene.tsx`** — top-level Canvas wrapper, always mounted:

- `<Canvas shadows dpr={[1, 2]} camera={{ position: [0, 1.5, 8], fov: 55 }}>`
- `<fog attach="fog" color="#1A0800" near={10} far={26} />`
- Lights: `ambientLight` (0.15, `#FF9F1C`) + 3 `pointLight`s per spec + `rectAreaLight`
- `<Environment preset="sunset" />`
- `<EffectComposer>`: Bloom (intensity 0.7, threshold 0.82) + ChromaticAberration (0.0006, 0.0008) + Vignette (offset 0.4, darkness 0.7)
- `<CaramelFluid />` background plane
- `<FloatingNav />` pinned at top of scene
- `{children}` slot — the active page scene renders here

**`src/3d/backgrounds/CaramelFluid.tsx`** — the viscous fluid sim:

- `<mesh rotation={[-Math.PI/2, 0, 0]} position={[0, -1.8, 0]}`
- `<planeGeometry args={[30, 30, 128, 128]} />`
- Custom `shaderMaterial` via drei's `shaderMaterial()` helper:
  - Uniforms: `uTime`, `uColorA (#1A0800)`, `uColorB (#C8640A)`
  - Vertex shader: 3 overlapping sine waves at different angles (frequencies 0.3–0.5), amplitude ~0.3, normals recalculated with cross-product derivatives
  - Fragment shader: mix colorA/colorB by height (vPosition.y), add specular highlight using recalculated normals + light direction
- `useFrame` increments `uTime` each frame

---

### Phase 3 — Core 3D Primitives

**`BobGroup.tsx`**

- Wraps children in a `<group ref>`, uses `useFrame` to set `group.position.y = Math.sin(t * 0.6 + offset) * 0.06` and `group.rotation.z = Math.sin(t * 0.4 + offset + 1.2) * 0.012`
- Props: `offset?: number` (default 0), `children`

**`DrippingEdge.tsx`**

- Accepts `panelWidth`, `panelBottom`
- Renders 6 `<mesh>` with `<capsuleGeometry args={[0.04, length, 6, 12]} />` and Molten Drip material
- `useFrame`: pendulum sway + slight scale.y pulse per drip (unique phase per drip)

**`CandyTile.tsx`**

- `<BobGroup offset={bobOffset}>`
  - `<RoundedBox args={[w, h, 0.22]} radius={0.18} smoothness={8}>` + Caramel Gloss material
  - `<DrippingEdge />`
  - `<group position={[0, 0, 0.14]}>{children}</group>` (content layer)
- Props: `width`, `height`, `bobOffset`, `children`
- Caramel Gloss `meshPhysicalMaterial`: `color="#FF9F1C"`, `roughness=0.05`, `transmission=0.15`, `thickness=1.2`, `ior=1.52`, `clearcoat=1`, `clearcoatRoughness=0.02`, `envMapIntensity=2.5`, `sheen=0.4`, `sheenColor="#FFD275"`

**`CandyButton.tsx`**

- `useSpring` from `@react-spring/three`: scale `[1,1,1]` → hover `[1.04,1.04,1.04]` → press `[1.08,0.82,1.08]`
- Press config: `tension:600, friction:12` | Hover config: `tension:200, friction:20`
- Geometry: `<capsuleGeometry args={[0.18, 0.8, 8, 24]} />` + Caramel Gloss material
- Label: `<Text>` (flat billboard) centered on face, `color="#FFFDF5"`, fontSize 0.14
- Props: `label`, `onClick`, `bobOffset`
- Bob via `<BobGroup>`

**`CandyHeadline.tsx`**

- `<Center>` → `<Text3D font="https://drei.pmnd.rs/fonts/helvetiker_regular.typeface.json">`
  *(Note: use Helvetiker from drei CDN as robust fallback; if Pacifico JSON becomes available place in `/public/fonts/` and switch path)*
- `size={0.7}`, `height={0.28}`, `curveSegments={32}`, `bevelEnabled`, `bevelThickness={0.06}`, `bevelSize={0.04}`, `bevelSegments={12}`
- Cream Coat material: `color="#FFFDF5"`, `roughness=0.08`, `clearcoat=1`, `envMapIntensity=3.0`

**`StatOrb.tsx`**

- Floating sphere widget for a single KPI number
- `<mesh>`: `<sphereGeometry args={[0.55, 64, 64]} />` + Caramel Gloss material
- `<Text>` (flat, billboard) on top: large count-up number in `#FFF4E0` extrabold
- `<Text>` below: label in `#FFD275` medium
- Count-up: `useSpring` interpolating `0 → value` over 1200ms, displayed via `animated.div` inside `<Html>` OR using drei's `<Text>` driven by a ref updated each frame from the spring value
- `<BobGroup>` wrapper

**`CandyInput.tsx`**

- `<RoundedBox args={[2.5, 0.5, 0.12]} radius={0.12} smoothness={6}>` + semi-transparent material (`transmission=0.4`, `roughness=0.1`, `color="#C8640A"`)
- `<Html center>` overlay with a styled `<input>` element (Tailwind: `bg-transparent text-[#FFFDF5] outline-none w-full text-center`)
- Focus ring: swap material color to `#FFD275` on focus via state

**`FloatingNav.tsx`**

- Horizontal group of 5 `<RoundedBox>` pill buttons, each with `<Text>` label
- Active page pill: Caramel Gloss material, inert pages: 30% opacity version
- Positioned at `[0, 3.2, 0]` (top of scene)
- Click handler calls React Router's `navigate()` via `useNavigate()` — works because `<Canvas>` is inside `<BrowserRouter>`
- Nav items: Hub · Network · Messages · Activity · Config

---

### Phase 4 — Page Scenes

**`HubScene.tsx`** (replaces Dashboard)

- `<CandyHeadline text="Carameli" />` at center-top
- 4 `<StatOrb>` in a shallow arc:
  - Position: `[-3.5, 0, 0]`, `[-1.2, 0.4, 0]`, `[1.2, 0.4, 0]`, `[3.5, 0, 0]`
  - Bob offsets: `0`, `0.8`, `1.7`, `2.5`
  - Data: activeLines, extensions, callEvents (today), smsEnabledLines
  - Sourced from same API calls as old Dashboard (api.phoneLines.getCount, etc.)
- API offline state: single `<CandyTile>` with `<Text>` "API Offline — run docker compose up"

**`NetworkScene.tsx`** (replaces Phone Lines + Extensions)

- Two `<CandyTile>` side by side: `position={[-2.2, 0, 0]}` and `position={[2.2, 0, 0]}`
- Left tile: Phone Lines panel
  - `<Text>` heading "Phone Lines"
  - `<CandyInput>` for area code
  - `<CandyButton label="Add Line" />`
  - List of active lines via `<Text>` entries or `<Html>` table
- Right tile: Extensions panel
  - `<Text>` heading "Extensions"
  - `<CandyInput>` for extension number
  - `<CandyButton label="Create" />`
  - Available extension number pills
- Same API calls as old PhoneLines.tsx + Extensions.tsx

**`MessagesScene.tsx`**, **`ActivityScene.tsx`**, **`ConfigScene.tsx`**

- Single centered `<CandyTile width={4} height={2.5} bobOffset={0}>`
- `<CandyHeadline text={pageName} />` + `<Text>` "Coming Soon" subtitle
- Styled placeholder, no data calls

---

### Phase 5 — Wiring (App.tsx + main.tsx)

**`App.tsx`** — rewrite:

```tsx
import { Canvas } from '@react-three/fiber'
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import Scene from './3d/Scene'
import HubScene from './3d/pages/HubScene'
// ... other scenes

function SceneRouter() {
  const location = useLocation()
  // render the correct scene child based on location.pathname
  // Scene stays mounted; only children swap
}

export default function App() {
  return (
    <BrowserRouter>
      <Scene>
        <SceneRouter />
      </Scene>
    </BrowserRouter>
  )
}
```

**`main.tsx`** — keep error handlers and logger setup, remove Outfit font import.

---

### Phase 6 — Cleanup

- Delete `src/components/Button.tsx`, `Card.tsx`, `Layout.tsx`
- Delete `src/pages/Dashboard.tsx`, `PhoneLines.tsx`, `Extensions.tsx`, `Placeholder.tsx`
- Gut `src/index.css` to canvas-only resets
- Strip old keyframes from `tailwind.config.js`

---

## Critical Files Modified

| File | Change |
| --- | --- |
| `frontend/package.json` | Add `@react-spring/three`, `@react-three/postprocessing` |
| `frontend/index.html` | Remove Google Fonts link, update title |
| `frontend/src/index.css` | Replace with canvas reset only |
| `frontend/tailwind.config.js` | Remove candleflicker/shimmer/arc keyframes |
| `frontend/src/App.tsx` | Full rewrite — Canvas + scene router |
| `frontend/src/main.tsx` | Remove Outfit font import |
| `frontend/src/api/client.ts` | No change |
| `frontend/src/lib/logger.ts` | No change |

## New Files Created (19)

`Scene.tsx`, `CaramelFluid.tsx`, `BobGroup.tsx`, `DrippingEdge.tsx`, `CandyTile.tsx`, `CandyButton.tsx`, `CandyHeadline.tsx`, `StatOrb.tsx`, `CandyInput.tsx`, `FloatingNav.tsx`, `HubScene.tsx`, `NetworkScene.tsx`, `MessagesScene.tsx`, `ActivityScene.tsx`, `ConfigScene.tsx`

## Files Deleted (7)

`Button.tsx`, `Card.tsx`, `Layout.tsx`, `Dashboard.tsx`, `PhoneLines.tsx`, `Extensions.tsx`, `Placeholder.tsx`

---

## Verification

1. `cd frontend && npm install` — confirm no peer dependency errors
2. `npm run dev` — canvas should fill the viewport, fluid background visible, no white screen
3. Hub scene: 4 stat orbs visible, all bob independently, count-up animates from 0
4. Click "Network" in nav bar: two tile panels slide in, phone line provision works end-to-end
5. `npm run build` — TypeScript must compile cleanly (strict mode)
6. `npm run lint:eslint` + `npm run lint:types` — no errors
