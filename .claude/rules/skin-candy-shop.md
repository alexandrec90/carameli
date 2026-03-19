---
description: Candy Shop skin visual design conventions (DOM/CSS/Tailwind UI)
paths:
  - frontend/src/skins/candy-shop/**/*.ts
  - frontend/src/skins/candy-shop/**/*.tsx
  - frontend/src/skins/candy-shop/**/*.css
---

# Rule: Candy Shop Skin — "Glossy Game UI"

> **Scope:** This rule applies only to the `candy-shop` skin (`frontend/src/skins/candy-shop/`).
> For the skin system architecture itself, see `.claude/rules/skin-architecture.md`.
> Other skins are not bound by this spec.

This is a **DOM-based skin** — React + Tailwind CSS + custom CSS. No Three.js, no canvas, no R3F.
The aesthetic is "Glossy Game UI": heavy caramel theme, everything feels 3D and liquid-smooth via
gradients and shadows, never via flat colors. Think mobile game meets high-end confectionery.

**Renderer:** React DOM
**Styling:** Tailwind CSS + inline CSS for custom properties (text-shadow stacks, clip-paths)
**Animation:** Framer Motion — `motion.div` components with spring physics
**No R3F, no Three.js, no canvas elements**

---

## Color Palette

| Token | Hex | Role |
|---|---|---|
| `caramel-pour` | `#C15A10` | Header background, primary caramel surface |
| `dark-choc` | `#5C3317` | Nav circle border, text shadow base, body text on light bg |
| `mid-choc` | `#8B4513` | Mid-layer text shadow |
| `cream-highlight` | `#FFF3CC` | Bottom-edge highlight on header, light accent |
| `cream-bg` | `#FFF8E7` | Nav circle gradient start, lightest surface |
| `cream-warm` | `#E8D09E` | Nav circle gradient end |
| `card-bg` | `#F5E6CC` | Card / content box background |
| `logo-top` | `#FFFFFF` | Logo text gradient top |
| `logo-bottom` | `#FFD37E` | Logo text gradient bottom |

**Rule:** Never use flat colors on any surface that has a gradient equivalent. Every surface
uses gradients, shadows, or both to simulate depth.

---

## Layout System

```html
<body>
  <Header>           ← sticky caramel pour with SVG drip bottom edge
    <Logo />
    <DrippingNav />  ← 4 circles "stuck" to the header's bottom drip edge
  </Header>
  <main>
    <ContentGrid />  ← cards with chocolate drip overlays
  </main>
```

### Header

- Background: `bg-[#C15A10]`
- Bottom edge: custom SVG clip-path or inline SVG with deep "U" squiggle drips
- Bottom border: `border-b-4 border-[#FFF3CC]/30` — simulates light hitting the drip edge
- Gloss overlay: `::after` pseudo-element with
  `background: linear-gradient(to bottom, rgba(255,243,204,0.4) 0%, transparent 50%)`
  applied to all `#C15A10` surfaces

**Apply the gloss overlay to every orange surface** — it is the signature "wet caramel" look.

---

## Logo

```tsx
// Font: thick script/cursive (e.g. Pacifico via Google Fonts)
// Color: vertical gradient #FFFFFF → #FFD37E
// Text shadow stack (applied via inline style or @layer utilities):
style={{
  backgroundImage: 'linear-gradient(to bottom, #FFFFFF, #FFD37E)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  textShadow: '2px 2px 0px #5C3317, 4px 4px 0px #8B4513, 0px 8px 15px rgba(0,0,0,0.4)',
}}
```

> Note: `text-shadow` does not apply to `webkit-text-fill-color: transparent`. Wrap the logo
> in a `<span>` with the shadow on the outer element and gradient on the inner element,
> or use a filter/drop-shadow approach.

---

## Navigation — "Sticky Circles"

Four nav items rendered as circles that appear attached to the bottom of the dripping header.

### Default state

```tsx
<motion.div
  className="
    w-24 h-24 rounded-full
    border-4 border-[#5C3317]
    bg-gradient-to-br from-[#FFF8E7] to-[#E8D09E]
    flex items-center justify-center
    cursor-pointer overflow-hidden
  "
>
  {/* icon only in resting state */}
</motion.div>
```

### Hover → expand to pill

```tsx
// Framer Motion spring — expands width to w-64, reveals label
const variants = {
  resting: { width: '6rem', borderRadius: '9999px' },
  hovered: { width: '16rem', borderRadius: '9999px' },
}

<motion.div
  variants={variants}
  animate={isHovered ? 'hovered' : 'resting'}
  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
>
  <AnimatePresence>
    {isHovered && (
      <motion.span
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="font-bold text-[#5C3317] whitespace-nowrap"
      >
        {label}
      </motion.span>
    )}
  </AnimatePresence>
</motion.div>
```

**Rules:**

- Spring params are fixed: `stiffness: 300, damping: 20` — bouncy but controlled
- Label text color: `#5C3317` (dark chocolate), bold weight
- Never use CSS `transition:` for the expand animation — always Framer Motion spring
- Circles must visually appear to hang from / be stuck to the drip edge of the header

---

## Cards / Content Boxes

```tsx
<div
  className="bg-[#F5E6CC] relative overflow-hidden"
  style={{
    borderRadius: '32px',
    boxShadow: 'inset 0 4px 10px rgba(255,255,255,0.5), 0 8px 24px rgba(92,51,23,0.2)',
  }}
>
  {/* Chocolate drip SVG overlay — covers top 1/3 of card */}
  <DrippingOverlay />

  {/* Content */}
</div>
```

### Drip overlay

- Positioned `absolute top-0 left-0 right-0` with `pointer-events-none`
- An SVG with a chocolate/caramel color fill (`#C15A10` or `#8B4513`)
- The SVG path creates irregular drip shapes hanging down from the top edge
- Height: ~33% of card height
- `z-index` above the card background, below the content text

### Inner glow rule

Every card must have `inset 0 4px 10px rgba(255,255,255,0.5)` in its `box-shadow`. This is
the "rounded and polished" effect — do not omit it.

---

## Typography

| Usage | Font | Treatment |
|---|---|---|
| Logo | Pacifico or thick script | Gradient + shadow stack (see above) |
| Nav labels | System sans-serif, bold | `font-bold text-[#5C3317]` |
| Card headings | Script or semi-bold rounded sans | Chocolate brown, drop shadow |
| Body text | System sans-serif | `text-[#5C3317]` or `text-[#8B4513]` |

**Rule:** No cold-gray or black text. All text uses chocolate-brown tones.

---

## Motion & Animation

**Library:** Framer Motion only. No CSS `transition:`, no `@keyframes` for interactive states.

| Interaction | Animation |
|---|---|
| Nav circle hover | Spring expand: `stiffness: 300, damping: 20` |
| Card hover | Subtle lift: `y: -4`, `boxShadow` change, spring `stiffness: 250, damping: 18` |
| Button press | Scale down: `scale: 0.95`, spring snap back |
| Page transitions | `AnimatePresence` fade + slide, `duration: 0.3` |

**Rule:** Every interactive element must have a Framer Motion response. Static hover via
CSS `:hover` is forbidden on primary interactive surfaces.

---

## Gloss Effect (Universal)

Apply to all `#C15A10` / caramel-colored surfaces:

```css
.caramel-surface {
  position: relative;
}
.caramel-surface::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom, rgba(255, 243, 204, 0.4) 0%, transparent 50%);
  pointer-events: none;
  border-radius: inherit;
}
```

Or as a Tailwind component class. The gloss overlay is non-negotiable — it is what makes
surfaces look wet rather than painted.

---

## Hard Rules Summary

1. **DOM only** — no canvas, no Three.js, no WebGL for this skin.
2. **Gradients everywhere** — no flat solid colors on any primary surface.
3. **Gloss overlay on all caramel surfaces** — the `rgba(255,243,204,0.4)` linear-gradient pseudo-element.
4. **Framer Motion springs for all interactions** — no CSS `transition:` on interactive states.
5. **Nav circles expand via spring** — `stiffness: 300, damping: 20`, exact values.
6. **Inner glow on every card** — `inset 0 4px 10px rgba(255,255,255,0.5)` always present.
7. **Chocolate drip SVG on every card** — top 1/3 overlay, pointer-events-none.
8. **Rounded corners: 32px on cards** — not `rounded-xl` (12px), not `rounded-2xl` (16px).
9. **No cold or gray tones** — text, borders, and shadows stay in the chocolate-cream palette.
10. **Script/cursive font for logo** — Pacifico or equivalent. Never a geometric sans for branding.
