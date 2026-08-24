import { PANEL_ASSETS } from './assets'
import { PANEL_IMG_TRANSFORMS, PANEL_BUBBLE_TRANSFORMS, PANEL_GRIDS } from './layoutConfig'
import type { BubbleTransform, EditorConfig, ImgTransform, LayoutKind, PanelGrid, PanelGrids } from './types'

// What a config *starts* as, and how one is copied. Split out of configOps.ts so that
// file could stay under the size limit; the seam is that nothing here reads a payload
// or an existing config's contents — these are the defaults and the clone.

/** localStorage key for the working copy — exported for the hook and its tests. */
export const CONFIG_KEY = 'comic-book:editConfig'

/**
 * A brand-new picture, before {@link addImg} drops it on a panel. Inset rather than
 * full-panel on purpose: a second picture added at 0/0/100/100 would land exactly on
 * top of the one already there and read as nothing having happened.
 */
export const NEW_IMAGE: Omit<ImgTransform, 'panel'> = {
  src: PANEL_ASSETS[0].src,
  alt: '',
  left: 20,
  top: 20,
  width: 55,
  height: 55,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  anchor: 'center center',
  spill: false,
}

/** A brand-new bubble, before {@link addBubble} drops it on a panel. */
export const NEW_BUBBLE: Omit<BubbleTransform, 'panel'> = {
  top: -35,
  right: -12,
  width: 55,
  rotate: -5,
  spill: true,
  type: 'soft',
  tail: 'down-left',
  content: 'text',
  text: 'New bubble',
  linkTo: null,
  hoverType: null,
  clickType: null,
}

export const LAYOUT_KINDS: LayoutKind[] = ['landscape', 'portrait', 'square']

/**
 * Deep clone of the three grids. Written out rather than spread because a grid is two
 * levels of array deep — a shallow copy would hand every working config the *same*
 * vertex table, and the first drag would edit the shipped constant along with it.
 */
export function cloneGrids(grids: PanelGrids): PanelGrids {
  const out = {} as PanelGrids
  for (const kind of LAYOUT_KINDS) {
    const grid = grids[kind]
    out[kind] = {
      vertices: grid.vertices.map(([x, y]) => [x, y]),
      panels: grid.panels.map(ring => [...ring]),
    }
  }
  return out
}

/** Deep clone of the on-disk constants — the canonical "default" config. */
export function seedConfig(): EditorConfig {
  return {
    images: PANEL_IMG_TRANSFORMS.map(t => ({ ...t })),
    bubbles: PANEL_BUBBLE_TRANSFORMS.map(b => ({ ...b })),
    grids: cloneGrids(PANEL_GRIDS),
  }
}

/** Deep clone of an arbitrary config (no shared references with the input). */
export function cloneConfig(c: EditorConfig): EditorConfig {
  return {
    images: c.images.map(t => ({ ...t })),
    bubbles: c.bubbles.map(b => ({ ...b })),
    grids: cloneGrids(c.grids),
  }
}

/** Replace one breakpoint's grid, returning a new config. */
export function setGrid(config: EditorConfig, kind: LayoutKind, grid: PanelGrid): EditorConfig {
  const next = cloneConfig(config)
  next.grids[kind] = { vertices: grid.vertices.map(([x, y]) => [x, y]), panels: grid.panels.map(r => [...r]) }
  return next
}

/**
 * Restore one breakpoint's grid to the shipped default, returning a new config. Per
 * breakpoint rather than all three, because the author is looking at one window shape
 * and undoing the other two's shapes unseen is not what "reset" reads as.
 */
export function resetGrid(config: EditorConfig, kind: LayoutKind): EditorConfig {
  return setGrid(config, kind, PANEL_GRIDS[kind])
}
