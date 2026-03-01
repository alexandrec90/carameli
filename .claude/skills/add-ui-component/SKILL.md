# Skill: Add a UI Component

Use this skill when asked to build a new front-end component for the Carameli UI.

All UI is rendered inside a React Three Fiber `<Canvas>`. There are no CSS-styled DOM panels for primary surfaces. Every component is a 3D mesh.

---

## Step 1 — Identify the Component Type

| Request | R3F Pattern |
| --- | --- |
| Button / call-to-action | Caramel Pill (`CapsuleGeometry` + squash-and-stretch spring) |
| Data card / stat panel | Candy Tile (`RoundedBox` + caramel drips + bob animation) |
| Form input / text field | Rounded slab (`RoundedBox`, thin depth) + flat `<Text>` label |
| Modal / overlay | Large Candy Tile centered in scene, dimmed background mesh |
| Navigation bar | Horizontal pill strip, `RoundedBox`, sticky at top of scene |
| Dashboard widget (gauge, counter, chart) | Candy Tile + animated SVG-in-canvas or instanced bar meshes |
| Background / environment | Caramel fluid shader plane + HDR environment |
| Heading / logo text | `Text3D` with script font, beveled, Cream Coat material |

---

## Step 2 — Read the Design Rule

Always read `.claude/rules/skin-carameli.md` before writing any component code.
Key sections to reference:

- **Materials Spec** — which `meshPhysicalMaterial` config to use per surface type
- **Animation System** — spring configs for squash-and-stretch and bob
- **Panel Geometry** — `RoundedBox` args, drip child requirements
- **Lighting Setup** — confirm scene has the required 3+ warm point lights
- **Post-Processing** — confirm `EffectComposer` is present in the scene root

Material configs are also available as named TypeScript constants in
`.claude/skills/add-ui-component/material-presets.ts` — import or copy from there
instead of re-typing raw values.

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

### Candy Tile Panel (data card / widget wrapper)

```tsx
function CandyTile({
  children,
  width = 3.2,
  height = 2.0,
  bobOffset = 0,
}: {
  children: React.ReactNode
  width?: number
  height?: number
  bobOffset?: number
}) {
  const groupRef = useRef<THREE.Group>(null!)

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() + bobOffset
    groupRef.current.position.y += (Math.sin(t * 0.6) * 0.06 - groupRef.current.position.y) * 0.1
    groupRef.current.rotation.z = Math.sin(t * 0.4 + 1.2) * 0.012
  })

  return (
    <group ref={groupRef}>
      <RoundedBox args={[width, height, 0.22]} radius={0.18} smoothness={8}>
        <meshPhysicalMaterial
          color="#FF9F1C"
          roughness={0.05}
          metalness={0}
          transmission={0.15}
          thickness={1.2}
          ior={1.52}
          clearcoat={1}
          clearcoatRoughness={0.02}
          envMapIntensity={2.5}
        />
      </RoundedBox>
      {/* Drips along bottom edge */}
      <DrippingEdge panelWidth={width} panelBottom={-height / 2} />
      {/* Content layer sits just in front of panel face */}
      <group position={[0, 0, 0.14]}>{children}</group>
    </group>
  )
}
```

### Caramel Pill Button

```tsx
function CandyButton({
  label,
  onClick,
  bobOffset = 0,
}: {
  label: string
  onClick?: () => void
  bobOffset?: number
}) {
  const [pressed, setPressed] = useState(false)
  const [hovered, setHovered] = useState(false)
  const groupRef = useRef<THREE.Group>(null!)

  const { scale } = useSpring({
    scale: pressed
      ? ([1.08, 0.82, 1.08] as [number, number, number])   // squash: spread X/Z, compress Y
      : hovered
      ? ([1.04, 1.04, 1.04] as [number, number, number])   // hover: uniform gentle lift
      : ([1, 1, 1] as [number, number, number]),
    config: pressed
      ? { tension: 600, friction: 12 }   // snappy press
      : { tension: 200, friction: 20 },  // slow hover approach
  })

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime() + bobOffset
    groupRef.current.position.y = Math.sin(t * 0.6) * 0.05
  })

  return (
    <group ref={groupRef}>
      <animated.group
        scale={scale}
        onPointerDown={() => setPressed(true)}
        onPointerUp={() => { setPressed(false); onClick?.() }}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => { setHovered(false); setPressed(false) }}
      >
        <mesh>
          <capsuleGeometry args={[0.18, 0.8, 8, 24]} />
          <meshPhysicalMaterial
            color="#FF9F1C"
            roughness={0.05}
            clearcoat={1}
            clearcoatRoughness={0.02}
            envMapIntensity={2.5}
          />
        </mesh>
        <Text
          position={[0, 0, 0.2]}
          fontSize={0.14}
          color="#FFFDF5"
          anchorX="center"
          anchorY="middle"
        >
          {label}
        </Text>
      </animated.group>
    </group>
  )
}
```

### Dripping Edge (required child of every panel)

```tsx
function DrippingEdge({ panelWidth, panelBottom }: { panelWidth: number; panelBottom: number }) {
  const dripCount = 6
  const dripsRef = useRef<THREE.Group>(null!)

  const drips = Array.from({ length: dripCount }, (_, i) => ({
    x: -panelWidth / 2 + 0.3 + (i / (dripCount - 1)) * (panelWidth - 0.6),
    length: 0.15 + Math.random() * 0.3,
    phase: i * 1.1,
  }))

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime()
    dripsRef.current.children.forEach((drip, i) => {
      drip.rotation.z = Math.sin(t * 0.3 + drips[i].phase) * 0.08
      drip.scale.y = 1 + Math.sin(t * 0.5 + drips[i].phase) * 0.04
    })
  })

  return (
    <group ref={dripsRef}>
      {drips.map((d, i) => (
        <mesh
          key={i}
          position={[d.x, panelBottom - d.length / 2, 0]}
        >
          <capsuleGeometry args={[0.04, d.length, 6, 12]} />
          <meshPhysicalMaterial
            color="#C8640A"
            roughness={0.12}
            transmission={0.25}
            thickness={0.8}
            ior={1.46}
            clearcoat={0.8}
            clearcoatRoughness={0.05}
            envMapIntensity={2.0}
          />
        </mesh>
      ))}
    </group>
  )
}
```

### Extruded Script Headline

```tsx
function CandyHeadline({ text }: { text: string }) {
  return (
    <Center>
      <Text3D
        font="/fonts/Pacifico_Regular.json"
        size={0.8}
        height={0.28}
        curveSegments={32}
        bevelEnabled
        bevelThickness={0.06}
        bevelSize={0.04}
        bevelSegments={12}
      >
        {text}
        <meshPhysicalMaterial
          color="#FFFDF5"
          roughness={0.08}
          clearcoat={1}
          clearcoatRoughness={0.01}
          envMapIntensity={3.0}
        />
      </Text3D>
    </Center>
  )
}
```

---

## Step 5 — Pre-Publish Checklist

- [ ] Component uses `meshPhysicalMaterial` — no `meshStandardMaterial` or `meshBasicMaterial` on primary surfaces
- [ ] Panel uses `RoundedBox` with `args[2] ≥ 0.18` (real depth) and `radius ≥ 0.14`
- [ ] Panel includes a `<DrippingEdge>` child with 4–8 drips
- [ ] Bob animation present via `useFrame` sine oscillation (`0.5–0.7 Hz`)
- [ ] Sibling panels have staggered `bobOffset` values (`0`, `0.8`, `1.7`, `2.5` …)
- [ ] Button uses asymmetric squash-and-stretch (`scale.y → 0.82` on press)
- [ ] Button hover is uniform scale lift (`1.04`) — distinct from press state
- [ ] Text headings use `Text3D` with `bevelEnabled`, `height ≥ 0.2`, script/rounded font
- [ ] Scene root has warm lighting: `ambientLight` + ≥ 3 colored `pointLight`s
- [ ] Scene root has `<Environment preset="sunset" />` (or warm HDR)
- [ ] Scene root has `EffectComposer` with Bloom + ChromaticAberration + Vignette
- [ ] Dashboard values animate from their starting state — use spring interpolation, not static render
- [ ] No flat CSS panels — all surfaces are `<mesh>` or `<group>` inside `<Canvas>`
