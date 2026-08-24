import { PANEL_ASSETS } from './assets'
import { PANEL_IMG_TRANSFORMS, PANEL_BUBBLE_TRANSFORMS, PANEL_GRIDS } from './layoutConfig'
import { cloneNumberPad } from './numberPadValidate'
import { cloneTable } from './tableValidate'
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
  // No projected-content key: a picture is not a surface until the author selects one
  // in its inspector, and absence is what "not a surface" is spelled as.
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

/**
 * Deep clone of one picture. Spread alone is not enough once a picture can carry
 * projected content: a surface holds a quad and a table also holds columns and cells;
 * a shallow copy would
 * hand the working copy the *same* arrays the shipped constant holds — the first corner
 * drag would then edit the module-level default along with it, which survives a Reset.
 *
 * A picture with no projected content comes back with neither optional **key**, rather
 * than with one set to undefined. The two are interchangeable to `toEqual` and JSON, so
 * nothing would have failed — which is the reason to be deliberate about it here: "not a
 * surface" is spelled as absence everywhere else, and a clone that quietly introduced the
 * key would make an `in` check mean nothing. If both fields appear in hand-edited data,
 * the established table wins; hydration enforces the same backward-compatible rule.
 */
export function cloneImg(t: ImgTransform): ImgTransform {
  const { table, numberPad, ...plain } = t
  if (table) return { ...plain, table: cloneTable(table) }
  if (numberPad) return { ...plain, numberPad: cloneNumberPad(numberPad) }
  return plain
}

/** Deep clone of the on-disk constants — the canonical "default" config. */
export function seedConfig(): EditorConfig {
  return {
    images: PANEL_IMG_TRANSFORMS.map(cloneImg),
    bubbles: PANEL_BUBBLE_TRANSFORMS.map(b => ({ ...b })),
    grids: cloneGrids(PANEL_GRIDS),
  }
}

/** Deep clone of an arbitrary config (no shared references with the input). */
export function cloneConfig(c: EditorConfig): EditorConfig {
  return {
    images: c.images.map(cloneImg),
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
