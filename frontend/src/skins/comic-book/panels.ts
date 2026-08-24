// The page's panels: the slots the comic grid is cut into, and nothing about what is
// drawn inside them. Pictures live in PANEL_IMG_TRANSFORMS and balloons in
// PANEL_BUBBLE_TRANSFORMS (editor/layoutConfig.ts), each naming the panel it sits on.
//
// It is its own module rather than a const in Layout.tsx because the editor overlay
// needs the same names, and Layout lazy-imports the overlay — importing a runtime
// value back out of Layout would close that into a cycle. The panel *shapes* are next
// door in panelGeometry.ts for the same reason, now that the editor edits them too.

/** Which page's grid a panel belongs to — the home 2×2 or the classic 8-panel grid. */
export type PanelPage = 'home' | 'classic'

/** Both pages, in the order the shipped grids and the serializer walk them. */
export const PANEL_PAGES: PanelPage[] = ['classic', 'home']

/** One panel of the grid. Geometry is computed per viewport; this is the rest. */
export interface Panel {
  /** Name shown in the editor, and the fallback alt for a picture that has none. */
  label: string
  /** The logo panel is styled apart from the story panels. */
  isLogo: boolean
  /** Route a click navigates to; null = not clickable. */
  path: string | null
  /** The page whose grid this panel sits on. */
  page: PanelPage
}

/**
 * Index-parallel to every grid's ring table — panel `i` is `PANELS[i]`. That
 * parallelism is the one that survives: a panel is a fixed slot, so there are exactly
 * as many of these as there are ring slots, however many pictures or balloons end up
 * on each. Only the panels whose `page` matches the current route carry a ring in
 * that page's grids; the rest hold an empty ring and render nothing.
 */
export const PANELS: Panel[] = [
  { label: 'Logo', isLogo: true, path: '/', page: 'classic' },
  { label: 'Switchboard', isLogo: false, path: '/phone-lines', page: 'classic' },
  { label: 'Mailman 1', isLogo: false, path: '/', page: 'classic' },
  { label: 'Mechanic', isLogo: false, path: '/extensions', page: 'classic' },
  { label: 'Receptionist', isLogo: false, path: '/phone-lines', page: 'classic' },
  { label: 'Rolodex', isLogo: false, path: '/extensions', page: 'classic' },
  { label: 'Rotary phone', isLogo: false, path: '/phone-lines', page: 'classic' },
  { label: 'Mailman 2', isLogo: false, path: '/', page: 'classic' },
  { label: 'Logo 2', isLogo: true, path: '/', page: 'home' },
  { label: 'Notepad', isLogo: false, path: '/sms', page: 'home' },
  { label: 'Push-button phone', isLogo: false, path: '/phone', page: 'home' },
  { label: 'Conversation', isLogo: false, path: '/calls', page: 'home' },
]

/**
 * The page a route shows: the 4-panel home grid on '/', the classic 8-panel grid
 * everywhere else — the old home page set aside rather than destroyed.
 */
export function pageForPath(pathname: string): PanelPage {
  return pathname === '/' ? 'home' : 'classic'
}
