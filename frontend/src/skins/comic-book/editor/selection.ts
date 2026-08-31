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
export const SELECTION_KINDS = ['panel', 'img', 'bubble', 'vertex', 'seam'] as const

/**
 * The same set as a type. Derived from the list rather than declared beside it so the two
 * cannot disagree.
 *
 * The list exists as a *value* so that a test can enumerate the editor's states instead of
 * naming them by hand — see `src/tests/skins/EditorSurfaceMatrix.test.tsx`. A guard that
 * lists the states it covers only ever protects the features that existed on the day it
 * was written; one that reads them from here grows a new column the moment a kind is
 * added, and the snapshot it writes then has to be reviewed.
 */
export type SelectionKind = (typeof SELECTION_KINDS)[number]

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
export const EDIT_MODES = ['content', 'shapes'] as const

/** The same pair as a type; a value too, for the reason {@link SelectionKind} gives. */
export type EditMode = (typeof EDIT_MODES)[number]

/** Set or clear the selection — what the mutator hooks are handed. */
export type SetSelection = (selection: Selection | null) => void
