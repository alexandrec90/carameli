// What a panel *is*: the slot type the comic grid is cut into, and nothing about what
// is drawn inside one. The list itself — PANELS — lives in editor/layoutConfig.ts beside
// the grids it is index-parallel to, because the editor appends to it (splitting a
// panel makes a new one) and that file is the one the editor's Save button writes.
// Pictures live in PANEL_IMG_TRANSFORMS and balloons in PANEL_BUBBLE_TRANSFORMS there
// too, each naming the panel it sits on.
//
// The type and the page helpers are their own module rather than consts in Layout.tsx
// because the editor overlay needs the same names, and Layout lazy-imports the overlay —
// importing a runtime value back out of Layout would close that into a cycle. The panel
// *shapes* are next door in panelGeometry.ts for the same reason, now that the editor
// edits them too.

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
  /** The page whose grid this panel sits on. */
  page: PanelPage
}

/**
 * The page a route shows: the 4-panel home grid on '/', the classic 8-panel grid
 * everywhere else — the old home page set aside rather than destroyed.
 */
export function pageForPath(pathname: string): PanelPage {
  return pathname === '/' ? 'home' : 'classic'
}
