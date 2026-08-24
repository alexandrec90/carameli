// The page's panels: the slots the comic grid is cut into, and nothing about what is
// drawn inside them. Pictures live in PANEL_IMG_TRANSFORMS and balloons in
// PANEL_BUBBLE_TRANSFORMS (editor/layoutConfig.ts), each naming the panel it sits on.
//
// It is its own module rather than a const in Layout.tsx because the editor overlay
// needs the same names, and Layout lazy-imports the overlay — importing a runtime
// value back out of Layout would close that into a cycle. The panel *shapes* are next
// door in panelGeometry.ts for the same reason, now that the editor edits them too.

/** One panel of the grid. Geometry is computed per viewport; this is the rest. */
export interface Panel {
  /** Name shown in the editor, and the fallback alt for a picture that has none. */
  label: string
  /** The logo panel is styled apart from the story panels. */
  isLogo: boolean
  /** Route a click navigates to; null = not clickable. */
  path: string | null
}

/**
 * Index-parallel to the polygons `gridPolys` returns — panel `i` is `PANELS[i]`.
 * That parallelism is the one that survives: a panel is a fixed slot in the grid, so
 * there are exactly as many of these as there are polygons, however many pictures or
 * balloons end up on each.
 */
export const PANELS: Panel[] = [
  { label: 'Logo', isLogo: true, path: '/' },
  { label: 'Switchboard', isLogo: false, path: '/phone-lines' },
  { label: 'Mailman 1', isLogo: false, path: '/' },
  { label: 'Mechanic', isLogo: false, path: '/extensions' },
  { label: 'Receptionist', isLogo: false, path: '/phone-lines' },
  { label: 'Rolodex', isLogo: false, path: '/extensions' },
  { label: 'Rotary phone', isLogo: false, path: '/phone-lines' },
  { label: 'Mailman 2', isLogo: false, path: '/' },
]
