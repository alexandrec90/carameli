# Skin Brief: <Name> (`<name>`)

> Copy this file to `skins/<name>.md` (or `.txt`) and fill in every section.
> The `add-skin` skill reads this brief before writing any code.
> Every decision — renderer choice, colors, motion — must be derivable from this doc alone.

---

## Identity

| Field | Value |
| --- | --- |
| Skin identifier (lowercase, no spaces) | `<name>` |
| PascalCase identifier | `<Name>` |
| One-sentence aesthetic summary | e.g. "Brutalist terminal UI with green phosphor glow" |
| Inspiration / mood board references | e.g. Fallout terminals, early 80s CRT, Lo-Fi Hip Hop |

---

## Renderer / Tech Stack

> Which rendering technology does this skin use?
> Different skins can use completely different stacks — R3F, plain CSS, Canvas 2D, SVG, etc.

| Layer | Choice |
| --- | --- |
| Primary renderer | e.g. React Three Fiber / plain DOM+CSS / Canvas 2D / SVG |
| Animation library | e.g. @react-spring/three / Framer Motion / CSS transitions / GSAP |
| Special dependencies | e.g. Three.js post-processing / p5.js / none |

---

## Color Palette

> Every color token the skin uses. These become `meshPhysicalMaterial` props (3D skins)
> or CSS variables / Tailwind tokens (DOM skins).

| Token name | Hex | Role |
| --- | --- | --- |
| `background` | `#______` | Scene/page background |
| `surface` | `#______` | Primary panel / card surface |
| `surface-alt` | `#______` | Secondary surface or hover state |
| `text-primary` | `#______` | Main readable text |
| `text-secondary` | `#______` | Labels, metadata, captions |
| `accent` | `#______` | CTAs, highlights, badges |
| `accent-alt` | `#______` | Secondary accent |
| `border` | `#______` | Dividers, outlines (if any) |
| `shadow` | `#______` | Drop shadows / depth |

Add or remove rows as needed. Every token used in component code must appear here.

---

## Layout System

> How is the screen divided? What is the navigation model?

- **Nav position:** e.g. left sidebar / top bar / hidden / floating overlay
- **Content area:** e.g. single scrollable column / fixed grid / 3D scene with floating panels
- **Breakpoints / responsive behaviour:** e.g. single layout (desktop only) / mobile-first columns

---

## Component Patterns

### Button

- **Shape:** e.g. pill / rectangle / hexagon / text-only / icon-only
- **Hover behaviour:** e.g. background fill / border glow / scale lift / cursor change
- **Press behaviour:** e.g. scale squash / color darken / ripple
- **Disabled state:** e.g. opacity 40%, no pointer events

### Panel / Card

- **Geometry:** e.g. flat div / RoundedBox 3D / canvas-drawn rounded rect
- **Depth / shadow:** e.g. drop-shadow 8px / 3D z-thickness 0.22 / flat
- **Border / outline:** e.g. 1px solid accent / none / inner glow
- **Idle animation:** e.g. bob at 0.6 Hz / static / subtle pulse

### Navigation item

- **Active state:** e.g. left border accent / background highlight / underline
- **Inactive state:** e.g. muted text / ghost style
- **Transition:** e.g. spring slide / CSS fade / instant

---

## Typography

| Usage | Typeface | Size (rem or 3D units) | Weight |
| --- | --- | --- | --- |
| Page headline | | | |
| Section heading | | | |
| Body / labels | | | |
| Numbers / counters | | | |
| Small metadata | | | |

> If this skin uses 3D text (`Text3D`), specify extrusion depth and bevel settings here.

---

## Motion & Animation

> Describe the overall feel of motion in this skin.

- **Pace:** e.g. snappy and instant / slow and viscous / spring-driven bounce
- **Easing philosophy:** e.g. spring physics (tension/friction) / ease-in-out curves / linear
- **Entry animations:** e.g. slide in from left / fade up / scale from 0 / none
- **Idle animations:** e.g. bob, pulse, glow cycle / all static
- **Data updates:** e.g. count-up spring interpolation / instant swap / crossfade

---

## Lighting (3D skins only)

> Skip this section for DOM/CSS skins.

- **Ambient light:** color + intensity
- **Key light:** position, color, intensity
- **Fill / rim lights:** list each
- **Environment map:** HDR preset name or custom file

---

## Post-Processing (3D skins only)

> Skip this section for DOM/CSS skins.

- **Bloom:** intensity, luminance threshold
- **Chromatic aberration:** offset
- **Vignette:** darkness
- **Other effects:** e.g. film grain, scan lines, depth of field

---

## Hard Rules

> A numbered list of explicit constraints — the things that must *never* happen in this skin.
> Be specific. These become the "Hard Rules Summary" in the `.claude/rules/skin-<name>.md` file.

1. ...
2. ...
3. ...

---

## Notes / Open Questions

> Anything uncertain, to be resolved during implementation.

- ...
