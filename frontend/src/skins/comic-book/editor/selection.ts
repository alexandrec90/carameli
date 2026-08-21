// What the editor can have selected, and which half of it is in front. Its own module so
// the mutator hooks can name a selection without importing the hook that owns one.

/**
 * What a selection can be. `'panel'` is a slot in the grid and indexes PANELS; `'img'`
 * and `'bubble'` index their own array in the config; `'vertex'` indexes the current
 * grid's vertex table and `'seam'` its seam list.
 *
 * A panel is selectable at all because a picture no longer *is* its panel: adding one
 * needs a panel to add it to, and an empty panel would otherwise be unclickable.
 */
export type SelectionKind = 'panel' | 'img' | 'bubble' | 'vertex' | 'seam'

/** A selectable thing: which array, and which entry of it. */
export interface Selection {
  kind: SelectionKind
  index: number
}

/**
 * Which half of the editor is in front. `'content'` edits what is *in* the panels —
 * pictures and balloons; `'shapes'` edits the panels themselves.
 *
 * They are modes rather than one merged surface because they want opposite things from
 * the same click: in content mode a click on a panel picks the picture under it, and in
 * shape mode it has to pick the seam the pointer is nearest, which may well be the edge
 * of a panel you are not over. Trying to serve both from one hit-test is how a drag
 * intended for a divider ends up nudging a balloon.
 */
export type EditMode = 'content' | 'shapes'

/** Set or clear the selection — what the mutator hooks are handed. */
export type SetSelection = (selection: Selection | null) => void
