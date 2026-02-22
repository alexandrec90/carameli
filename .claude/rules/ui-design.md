---
description: Carameli UI design system conventions
paths:
  - frontend/src/**/*.ts
  - frontend/src/**/*.tsx
  - frontend/src/**/*.css
  - frontend/index.html
  - frontend/tailwind.config.js
---

# Rule: Carameli UI Design System ("Liquid Luxury")

The Carameli front-end follows a **Neumorphism + Glassmorphism** hybrid aesthetic.
Every visual decision should reinforce the "polished amber surface glowing from within" metaphor.

---

## Color Palette (Sugar Spectrum)

Always use as gradients — never flat fills.

| Token | Hex | Role |
| --- | --- | --- |
| `deep-base` | `#1A0F00` | Page / section backgrounds |
| `primary-gloss` | `#FF9F1C` | Primary buttons, key actions |
| `soft-glow` | `#FFD275` | Active states, highlights, focus rings |
| `accent-cream` | `#FFF4E0` | Body text, icon fills, labels |
| `glass-stroke` | `rgba(255, 244, 224, 0.1)` | Card borders, dividers |

### Gradient Conventions

```css
/* Primary button fill */
background: linear-gradient(to bottom right, #FF9F1C, #E68A00);

/* Warm surface overlay */
background: linear-gradient(to bottom right, rgba(255,159,28,0.12), rgba(26,15,0,0.6));
```

**Hard rule: never use a single flat hex as a `background-color` for any interactive element.**

---

## Shadows

Use warm, colored shadows — never default `rgba(0,0,0,...)`.

```css
/* Standard card shadow */
box-shadow: 0 10px 30px -5px rgba(26, 15, 0, 0.5);

/* Raised button (resting state) */
box-shadow:
  0 4px 15px -2px rgba(255, 159, 28, 0.4),
  inset 0 1px 0 rgba(255, 244, 224, 0.15);

/* Pressed / active state — button sinks inward */
box-shadow:
  inset 0 3px 8px rgba(26, 15, 0, 0.6),
  0 1px 2px rgba(26, 15, 0, 0.3);
```

---

## Surface Physics (Light Source)

- **Light direction:** top-left at all times.
- Every card/panel must have a 1px highlight on the **top and left edges**:

```css
border: 1px solid transparent;
border-top-color: rgba(255, 244, 224, 0.15);
border-left-color: rgba(255, 244, 224, 0.15);
border-bottom-color: rgba(255, 244, 224, 0.04);
border-right-color: rgba(255, 244, 224, 0.04);
```

- Bottom-right gets the diffuse shadow (see Shadows above).

---

## Corner Radii

| Component type | Radius |
| --- | --- |
| Cards, panels, modals | `32px` |
| Buttons (standard) | `20px` |
| Buttons (pill / full) | `9999px` |
| Inputs, dropdowns | `16px` |
| Badges, tags | `8px` |

---

## Backdrop Blur (Glass Effects)

Navigation bars, overlays, modals, and any element layered over content:

```css
backdrop-filter: blur(25px);
-webkit-backdrop-filter: blur(25px);
background: rgba(26, 15, 0, 0.55);
/* Optionally add a subtle noise texture via SVG data-URI for "frosted amber" depth */
```

---

## Candlelight Flicker (Glass Animation)

All glass surfaces (cards, panels, nav) carry a perpetual ambient glow that simulates candlelight — organic and irregular, never mechanical.

```css
@keyframes candleflicker {
  0%,  100% { box-shadow: 0 0 20px rgba(255,159,28,0.12), 0 0 45px rgba(255,159,28,0.06); }
  15%        { box-shadow: 0 0 26px rgba(255,159,28,0.18), 0 0 55px rgba(255,159,28,0.09); }
  30%        { box-shadow: 0 0 17px rgba(255,159,28,0.10), 0 0 38px rgba(255,159,28,0.05); }
  50%        { box-shadow: 0 0 30px rgba(255,159,28,0.22), 0 0 60px rgba(255,159,28,0.11); }
  70%        { box-shadow: 0 0 15px rgba(255,159,28,0.08), 0 0 32px rgba(255,159,28,0.04); }
  85%        { box-shadow: 0 0 24px rgba(255,159,28,0.16), 0 0 50px rgba(255,159,28,0.08); }
}

.glass-flicker {
  animation: candleflicker 4s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}
```

- Keyframe stops are **deliberately irregular** — avoid even spacing so the flicker feels alive, not pulsing.
- Duration: `4s`. Stagger siblings with `animation-delay` (`0.3s`, `0.7s`, `1.1s`) so panels do not breathe in unison.
- Intensity cap: outer glow never exceeds `rgba(255,159,28,0.25)` — warmth, not neon.
- Combines with the standard card shadow; the flicker animates only the **outer ambient glow layer**, leaving the structural drop-shadow static.

In Tailwind (register `candleflicker` in `tailwind.config.theme.extend.keyframes`):

```html
<div class="animate-[candleflicker_4s_cubic-bezier(0.4,0,0.2,1)_infinite] [animation-delay:0.3s]
            bg-[rgba(26,15,0,0.55)] backdrop-blur-[25px] rounded-[32px]">
```

---

## Motion & Easing

**All transitions** must use the custom cubic-bezier — never `ease`, `ease-in-out`, or `linear`.

```css
transition: all 250ms cubic-bezier(0.4, 0, 0.2, 1);
```

### Button Interaction (press-and-sink)

```css
/* Default */
transform: scale(1);

/* :active */
transform: scale(0.97);
box-shadow: inset 0 3px 8px rgba(26, 15, 0, 0.6);
```

### Loading / Skeleton Shimmer

Animate a gradient sweep left-to-right to simulate "liquid gold flowing":

```css
@keyframes shimmer {
  0%   { background-position: -200% center; }
  100% { background-position:  200% center; }
}

.skeleton {
  background: linear-gradient(
    90deg,
    rgba(255, 159, 28, 0.05) 25%,
    rgba(255, 210, 117, 0.18) 50%,
    rgba(255, 159, 28, 0.05) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.6s cubic-bezier(0.4, 0, 0.2, 1) infinite;
}
```

### Hover & Active Glow States

Every interactive surface must expose two **categorically different** glow states — never collapse them into one.

| State | Glow direction | Transform | Speed |
| --- | --- | --- | --- |
| `:hover` | Outward amber halo | `translateY(-1px)` | `250ms` |
| `:active` | Inward press + `#FFD275` corona | `scale(0.97)` | `80ms` |

```css
/* Hover — surface lifts toward the user with a warm amber halo */
.interactive:hover {
  box-shadow:
    0 0 30px rgba(255, 159, 28, 0.28),
    0 12px 40px -5px rgba(26, 15, 0, 0.45);
  border-top-color: rgba(255, 244, 224, 0.28);
  border-left-color: rgba(255, 244, 224, 0.28);
  transform: translateY(-1px);
  transition: all 250ms cubic-bezier(0.4, 0, 0.2, 1);
}

/* Active / click — press-and-sink + soft-glow (#FFD275) corona flash */
.interactive:active {
  transform: scale(0.97) translateY(0);
  box-shadow:
    inset 0 3px 8px rgba(26, 15, 0, 0.6),
    0 0 18px rgba(255, 210, 117, 0.45);   /* #FFD275 corona, not #FF9F1C */
  border-top-color: rgba(255, 244, 224, 0.08);
  border-left-color: rgba(255, 244, 224, 0.08);
  transition: all 80ms cubic-bezier(0.4, 0, 0.2, 1);  /* snappy on strike */
}
```

Rules:
- Hover uses `translateY(-1px)` lift — **never** `scale()` (scale is reserved for active only).
- Active corona uses `#FFD275` (`soft-glow`) — **not** `#FF9F1C` — to signal a different energy from the resting amber.
- The asymmetric timing (250 ms hover, 80 ms active) makes clicks feel physical: slow approach, instant strike.
- Non-clickable cards: apply hover state only. Add active state only if the card navigates or triggers an action.

---

## Typography

| Usage | Font | Weight | Color |
| --- | --- | --- | --- |
| Headlines (H1–H2) | Satoshi, Outfit, or Inter | 800 (Extra-Bold) | `#FFF4E0` |
| Sub-headings (H3–H4) | Same | 700 (Bold) | `#FFF4E0` |
| Body / paragraphs | Same | 500 (Medium) | `#FFF4E0` at `opacity: 0.85` |
| Labels / captions | Same | 500 | `#FFD275` |
| Disabled / muted | Same | 400 | `#FFF4E0` at `opacity: 0.35` |

Load order preference: `Satoshi` → `Outfit` → `Inter` (fallback).

---

## Iconography

- Style: **duo-tone with rounded stroke caps**.
- Primary path fill: `#FF9F1C`
- Secondary path fill: `rgba(255, 159, 28, 0.35)` (same hue, lower opacity)
- Never use a flat monochrome icon without applying the duo-tone treatment.

---

## Component Patterns

### "Caramel Drop" Button

```css
.btn-primary {
  background: linear-gradient(to bottom right, #FF9F1C, #E68A00);
  border-radius: 20px;               /* or 9999px for pill */
  border: 2px solid transparent;
  /* Gradient border trick */
  background-clip: padding-box;
  box-shadow:
    0 4px 15px -2px rgba(255, 159, 28, 0.4),
    inset 0 1px 0 rgba(255, 244, 224, 0.2);
  color: #1A0F00;
  font-weight: 700;
  transition: all 250ms cubic-bezier(0.4, 0, 0.2, 1);
}

.btn-primary:active {
  transform: scale(0.97);
  box-shadow: inset 0 3px 8px rgba(26, 15, 0, 0.5);
}
```

### "Amber Tray" Card

```css
.card {
  background: rgba(26, 15, 0, 0.55);
  backdrop-filter: blur(25px);
  -webkit-backdrop-filter: blur(25px);
  border-radius: 32px;
  border: 1px solid rgba(255, 244, 224, 0.1);
  border-top-color: rgba(255, 244, 224, 0.15);
  border-left-color: rgba(255, 244, 224, 0.15);
  box-shadow: 0 10px 30px -5px rgba(26, 15, 0, 0.5);
}
```

### Dashboard Widgets (Gauges, Graphs, Counters)

Minimalist data surfaces. No axis borders, no tick marks. Grid lines only when essential, at ≤4% opacity.

#### Design Rules

- **Container**: Amber Tray card + `candleflicker` animation on the wrapper.
- **Data fills**: amber gradient (`#FF9F1C` → `#FFD275`) for filled regions; `rgba(255,244,224,0.06)` for empty tracks/backgrounds.
- **Labels**: `#FFD275`, `font-medium`. Values: `#FFF4E0`, `font-extrabold`.
- **All values animate from zero on mount** — nothing renders statically without first drawing in.

#### Load-In Animations

```css
/* SVG arc / gauge draw-in */
@keyframes arc-draw {
  from { stroke-dashoffset: var(--arc-total); }
  to   { stroke-dashoffset: var(--arc-offset); }
}

/* Bar / column grow from baseline */
@keyframes bar-grow {
  from { transform: scaleY(0); }
  to   { transform: scaleY(1); }
}
/* Always set transform-origin: bottom on bar elements */

/* Number count-up: driven by JS requestAnimationFrame,
   eased by the same cubic-bezier(0.4, 0, 0.2, 1) */
```

Timing:
- Bars and arcs: `800ms`, `cubic-bezier(0.4, 0, 0.2, 1)`, `animation-fill-mode: forwards`.
- Count-up numbers: `1200ms`.
- Stagger siblings `100ms` per element — bars and arc segments cascade in left-to-right.

#### Radial Gauge (SVG)

```tsx
export function RadialGauge({ value, max, label }: GaugeProps) {
  const R = 54;
  const arc = Math.PI * R;                          // half-circle circumference
  const offset = ((max - value) / max) * arc;

  return (
    <article
      className="
        bg-[rgba(26,15,0,0.55)] backdrop-blur-[25px]
        rounded-[32px] p-6
        border border-[rgba(255,244,224,0.1)]
        border-t-[rgba(255,244,224,0.15)] border-l-[rgba(255,244,224,0.15)]
        shadow-[0_10px_30px_-5px_rgba(26,15,0,0.5)]
        animate-[candleflicker_4s_cubic-bezier(0.4,0,0.2,1)_infinite]
      "
    >
      <svg viewBox="0 0 120 70" className="w-full overflow-visible">
        <defs>
          <linearGradient id="gauge-fill" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#FF9F1C" />
            <stop offset="100%" stopColor="#FFD275" />
          </linearGradient>
        </defs>
        {/* Empty track */}
        <path d="M 10 60 A 54 54 0 0 1 110 60"
          fill="none" stroke="rgba(255,244,224,0.06)" strokeWidth="8" strokeLinecap="round" />
        {/* Filled arc — draws in on mount */}
        <path d="M 10 60 A 54 54 0 0 1 110 60"
          fill="none" stroke="url(#gauge-fill)" strokeWidth="8" strokeLinecap="round"
          strokeDasharray={arc} strokeDashoffset={arc}
          className="animate-[arc-draw_800ms_cubic-bezier(0.4,0,0.2,1)_forwards]"
          style={{ '--arc-total': arc, '--arc-offset': offset } as React.CSSProperties}
        />
      </svg>
      <p className="text-[#FFF4E0] font-extrabold text-3xl text-center -mt-2">{value}</p>
      <p className="text-[#FFD275] font-medium text-sm text-center mt-1">{label}</p>
    </article>
  );
}
```

#### Bar Chart

```tsx
export function BarChart({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(...data.map(d => d.value));

  return (
    <article
      className="
        bg-[rgba(26,15,0,0.55)] backdrop-blur-[25px]
        rounded-[32px] p-6
        border border-[rgba(255,244,224,0.1)]
        border-t-[rgba(255,244,224,0.15)] border-l-[rgba(255,244,224,0.15)]
        shadow-[0_10px_30px_-5px_rgba(26,15,0,0.5)]
      "
    >
      <div className="flex items-end gap-3 h-32">
        {data.map((d, i) => (
          <div key={d.label} className="flex-1 flex flex-col items-center gap-2">
            <div
              className="
                w-full rounded-t-[8px]
                bg-gradient-to-t from-[#FF9F1C] to-[#FFD275]
                origin-bottom
                animate-[bar-grow_800ms_cubic-bezier(0.4,0,0.2,1)_forwards]
              "
              style={{
                height: `${(d.value / max) * 100}%`,
                animationDelay: `${i * 100}ms`,
                animationFillMode: 'both',
              }}
            />
            <span className="text-[#FFD275] text-xs font-medium">{d.label}</span>
          </div>
        ))}
      </div>
    </article>
  );
}
```

---

## Tailwind Implementation Rules

When writing Tailwind classes, always prefer the custom-value bracket syntax to
maintain exact design token values:

```html
<!-- Background: always gradient, never solid -->
<div class="bg-gradient-to-br from-[#FF9F1C] to-[#E68A00]">

<!-- Card surface -->
<div class="bg-[rgba(26,15,0,0.55)] backdrop-blur-[25px] rounded-[32px] border border-[rgba(255,244,224,0.1)]">

<!-- Text -->
<p class="text-[#FFF4E0] font-medium">
```

Do **not** extend the Tailwind config for one-off values; use brackets inline.
Only add tokens to `tailwind.config` when a value is used in 4+ places.

---

## Hard Rules Summary

1. **No flat fills** on interactive or branded elements — always a gradient.
2. **Warm shadows only** — never `rgba(0,0,0,...)` in isolation.
3. **Cubic-bezier everywhere** — no `ease` or `linear` for UI transitions.
4. **Backdrop blur on overlays** — `blur(25px)` minimum.
5. **Duo-tone icons** — primary `#FF9F1C`, secondary at 35% opacity.
6. **Top-left light source** — bright top/left border, shadow bottom-right.
7. **Press-and-sink on all buttons** — `scale(0.97)` + inset shadow on `:active`.
8. **Shimmer loaders** — use the amber gradient shimmer, not gray skeleton bars.
9. **Candlelight flicker on all glass** — `candleflicker` keyframe, `4s`, stagger siblings by `0.3s+`; outer glow only, never the structural shadow.
10. **Hover ≠ active** — hover lifts outward (`translateY(-1px)` + amber halo, `250ms`); active strikes inward (`scale(0.97)` + `#FFD275` corona, `80ms`). These must feel categorically different.
11. **Dashboard widgets animate from zero** — arcs draw in via `stroke-dashoffset`, bars grow via `scaleY`, numbers count up in JS; stagger siblings `100ms` per element.
