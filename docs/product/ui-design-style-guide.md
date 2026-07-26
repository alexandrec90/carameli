# Project Carameli: UI/UX Design System & Style Guide

## 1. Core Vision: "Liquid Luxury"

The aesthetic for **Carameli** is ultra-sleek, premium, and tactile. It should avoid the "flat" look of 2010s web design, favoring a hybrid of **Neumorphism** and **Glassmorphism**. Think of the interface as a series of polished amber surfaces, glowing from within.

---

## 2. The Color Palette (Sugar Spectrum)

All colors should be used as gradients to simulate depth and light refraction.

| Layer | Hex Code | Usage |
| :--- | :--- | :--- |
| **Deep Base** | `#1A0F00` | Backgrounds (Burnt Sugar / Onyx) |
| **Primary Gloss** | `#FF9F1C` | Primary Buttons (Salted Caramel) |
| **Soft Glow** | `#FFD275` | Active states & Highlights (Honey) |
| **Accent Cream** | `#FFF4E0` | Typography & Iconography (Sweet Cream) |
| **Glass Stroke** | `rgba(255, 244, 224, 0.1)` | Subtle borders for card depth |

---

## 3. Visual Language & Depth

* **Surface Physics:** Use a "Top-Left" light source. Every card should have a subtle 1px inner-border on the top and left to simulate a highlight, and a soft, diffuse shadow on the bottom-right.
* **Corner Radii:** Extremely rounded.
* **Large Cards:** `32px`
* **Standard Buttons:** `20px` or `Full` (Pill-shaped)
* **Backdrop Blur:** Use `backdrop-filter: blur(25px)` for any overlays or navigation bars to create a "thick syrup" density.

---

## 4. Motion & Viscosity (The Physics Engine)

Animations must feel "heavy" yet smooth. Avoid "snappy" or "bouncy" linear transitions.

* **Easing:** Use custom cubic-beziers: `cubic-bezier(0.4, 0, 0.2, 1)`.
* **Interaction:** When a user presses a button, it should visually "sink" into the background using an `inset` box-shadow and a slight scale down (`scale(0.97)`).
* **Loading States:** Use a "shimmer" effect that moves like liquid gold flowing across the screen.

---

## 5. Typography & Iconography

* **Font Choice:** A clean, geometric Sans-Serif (e.g., *Satoshi, Outfit, or Inter*).
* **Headlines Weight:** Bold or Extra-Bold in `#FFF4E0`.
* **Body Weight:** Medium weight to ensure readability against dark, warm backgrounds.
* **Icons:** Use "Duo-tone" icons with rounded caps. The primary path should be `#FF9F1C` and the secondary path should be a lower opacity version of the same color.

---

## 6. Technical Implementation Guidelines for AI

When generating code (Tailwind, CSS, or SwiftUI), follow these specific rules:

1. **No Flat Colors:** Never use `bg-[#FF9F1C]`. Use `bg-gradient-to-br from-[#FF9F1C] to-[#E68A00]`.
2. **Complex Shadows:** Instead of a single black shadow, use a colored shadow: `box-shadow: 0 10px 30px -5px rgba(26, 15, 0, 0.5)`.
3. **Haptic Visuals:** Implement active states that change the "internal glow" of the component rather than just changing the opacity.
4. **Glass Effects:** Use semi-transparent backgrounds with a subtle noise texture to simulate high-end "frosted amber" glass.

---

## 7. Component Examples

* **The "Caramel Drop" Button:** A high-gloss button with a 2px white-to-transparent gradient border and a subtle drop shadow.
* **The "Amber Tray" Card:** A dark, semi-transparent container with high blur and a light-cream stroke.
