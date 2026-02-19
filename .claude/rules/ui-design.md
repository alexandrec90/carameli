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
