---
description: Barebone skin visual design conventions (minimal DOM/CSS UI)
paths:
  - frontend/src/skins/barebone/**/*.ts
  - frontend/src/skins/barebone/**/*.tsx
---

# Rule: Barebone Skin — "Structure First"

> **Scope:** This rule applies only to the `barebone` skin (`frontend/src/skins/barebone/`).
> For the skin system architecture itself, see `.claude/rules/skin-architecture.md`.

## Purpose

The barebone skin is a structural reference skin. It renders every view and piece of
data with the minimum possible styling so the UI layout hierarchy is immediately
readable. Use it to understand page structure before designing more complex skins.

## Tech Stack

**Renderer:** React DOM (no canvas, no Three.js, no animation libraries)
**CSS strategy:** Inline styles only — no Tailwind classes, no CSS modules, no external stylesheets
**Font:** System stack — `font-family: system-ui, sans-serif`
**Dependencies:** React + react-router-dom only (already in the bundle)

## Color Palette

| Token     | Hex       | Role                            |
| --------- | --------- | ------------------------------- |
| `bg`      | `#ffffff` | Page background                 |
| `surface` | `#f5f5f5` | Card / panel background         |
| `border`  | `#cccccc` | All borders and dividers        |
| `text`    | `#111111` | Primary text                    |
| `muted`   | `#666666` | Labels, secondary text          |
| `active`  | `#0057b8` | Active nav link, primary action |
| `danger`  | `#cc0000` | Destructive actions             |
| `ok`      | `#007700` | Success / online status         |

## Layout System

Single-column sidebar layout:

```text
┌──────────────────────────────────────┐
│  HEADER (app name + status badge)    │
├──────────┬───────────────────────────┤
│  SIDEBAR │  MAIN CONTENT             │
│  (nav)   │  (page view)              │
└──────────┴───────────────────────────┘
```

- Sidebar: fixed 160 px wide, full height, `#f5f5f5` background, `1px solid #cccccc` right border
- Header: full width, 40 px tall, `1px solid #cccccc` bottom border
- Main: fills remaining space, 16 px padding, scrollable
- Overall shell: `display: flex; flex-direction: column; height: 100vh`

## Component Patterns

### Nav link

Plain `<a>` / `<button>` styled with padding `8px 12px`, no border-radius, full sidebar width.
Active link: `font-weight: bold; color: #0057b8; background: #e8e8e8`.
Inactive link: `color: #111111`.

### Table

Use `<table>` with `border-collapse: collapse; width: 100%`.
`<th>`: `text-align: left; border-bottom: 2px solid #cccccc; padding: 6px 8px; font-size: 12px; text-transform: uppercase; color: #666666`.
`<td>`: `padding: 6px 8px; border-bottom: 1px solid #eeeeee`.

### Form / Input

Plain `<input>` and `<button>` with 1 px bordered box style:

- Input: `border: 1px solid #cccccc; padding: 4px 8px; font-size: 14px`
- Button: `border: 1px solid #0057b8; padding: 4px 12px; background: #0057b8; color: #ffffff; cursor: pointer`
- Danger button: same but `#cc0000`
- Disabled state: `opacity: 0.5; cursor: not-allowed`

### Status badge

Small inline `<span>` with `font-size: 11px; padding: 2px 6px; border-radius: 3px`.
Online: `background: #d4edda; color: #007700`.
Offline: `background: #f8d7da; color: #cc0000`.

## Typography

- Body: 14 px, `#111111`, system-ui
- Headings: `<h1>` 20 px bold, `<h2>` 16 px bold — standard HTML headings, no custom styles
- Labels / metadata: 12 px, `#666666`
- Monospace (phone numbers, SIP strings): `font-family: monospace`

## Motion & Animation

**None.** Zero transitions, zero keyframes. Every state change is instant.
If a future maintainer adds `transition:` to this skin, revert it.

## Hard Rules Summary

1. Inline styles only — no Tailwind, no CSS classes, no stylesheet imports.
2. No animation or transition properties anywhere.
3. No third-party UI libraries (no MUI, no Radix, no Headless UI).
4. No canvas, no WebGL, no SVG diagrams — plain HTML elements only.
5. No icons or emoji in display text — words only.
6. Every piece of data visible in props must be rendered; no filtering or hiding.
7. Destructive actions (deactivate, delete) must use `#cc0000` styling.
8. The layout must work at 800 px viewport width without horizontal scroll.
