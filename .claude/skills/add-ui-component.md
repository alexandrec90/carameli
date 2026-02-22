# Skill: Add a UI Component

Use this skill when asked to build a new front-end component for the Carameli UI.

## Steps

1. **Identify the component type** from the request:
   - Button variant → use the "Caramel Drop" pattern
   - Data container → use the "Amber Tray" card pattern
   - Form input → rounded-[16px], glass background, soft-glow focus ring
   - Modal / overlay → backdrop-blur(25px) + Amber Tray card
   - Navigation bar → backdrop-blur(25px), sticky, deep-base background
   - Dashboard widget (gauge, graph, counter) → Amber Tray card + candleflicker + load-in animation

2. **Read the relevant rule** before writing any code:
   - `.claude/rules/ui-design.md` — color tokens, shadow patterns, animation rules

3. **Apply every Hard Rule** from `ui-design.md`:
   - Gradient fill (never flat color)
   - Warm colored shadow
   - `cubic-bezier(0.4, 0, 0.2, 1)` transitions
   - Top-left light source border treatment
   - Press-and-sink `:active` state on all buttons
   - Duo-tone icons if icons are included
   - Shimmer skeleton if the component has a loading state
   - Candlelight flicker animation on all glass surfaces
   - Distinct hover (outward lift + amber halo) and active (inward press + `#FFD275` corona) states
   - Load-in animation from zero if the component contains data visualizations (arc-draw, bar-grow, count-up)

4. **Write the component** following the project's chosen framework/stack:
   - If Tailwind: use bracket syntax for design-token values
   - If plain CSS: use custom properties or the exact hex/rgba values from the palette
   - Keep markup semantic (`<button>`, `<article>`, `<nav>`, etc.)

5. **Checklist before finishing:**
   - [ ] No flat `background-color: #FF9F1C` — replaced with gradient
   - [ ] Shadow uses warm `rgba(26, 15, 0, ...)` tones
   - [ ] Transition uses `cubic-bezier(0.4, 0, 0.2, 1)`
   - [ ] Button has `:active` scale + inset shadow
   - [ ] Loading state uses amber shimmer (not gray bars)
   - [ ] Corners match radii spec (32px card, 20px/pill button, 16px input)
   - [ ] Backdrop blur on any overlay or nav element
   - [ ] Glass surfaces have `candleflicker` animation; siblings staggered with `animation-delay`
   - [ ] Hover state is outward glow + `translateY(-1px)` (250ms); active state is `scale(0.97)` + `#FFD275` corona (80ms)
   - [ ] Dashboard widget values animate from zero on mount (arc-draw / bar-grow / count-up), siblings staggered 100ms

## Example Output (Tailwind)

```tsx
// "Amber Tray" stat card with shimmer loading state
export function StatCard({ label, value, loading }: StatCardProps) {
  if (loading) {
    return (
      <div className="rounded-[32px] p-6 animate-[shimmer_1.6s_cubic-bezier(0.4,0,0.2,1)_infinite]
                      bg-[linear-gradient(90deg,rgba(255,159,28,0.05)_25%,rgba(255,210,117,0.18)_50%,rgba(255,159,28,0.05)_75%)]
                      bg-[length:200%_100%]" />
    );
  }

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
      <p className="text-[#FFD275] font-medium text-sm">{label}</p>
      <p className="text-[#FFF4E0] font-extrabold text-3xl mt-1">{value}</p>
    </article>
  );
}
```

```tsx
// "Caramel Drop" primary button
export function PrimaryButton({ children, onClick }: ButtonProps) {
  return (
    <button
      onClick={onClick}
      className="
        bg-gradient-to-br from-[#FF9F1C] to-[#E68A00]
        text-[#1A0F00] font-bold
        px-6 py-3 rounded-[20px]
        shadow-[0_4px_15px_-2px_rgba(255,159,28,0.4),inset_0_1px_0_rgba(255,244,224,0.2)]
        transition-all duration-[250ms] [transition-timing-function:cubic-bezier(0.4,0,0.2,1)]
        active:scale-[0.97] active:shadow-[inset_0_3px_8px_rgba(26,15,0,0.5)]
      "
    >
      {children}
    </button>
  );
}
```
