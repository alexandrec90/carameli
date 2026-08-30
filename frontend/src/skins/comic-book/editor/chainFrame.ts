import {
  bubbleHeightPct, chainColumns, chainIdsOn, chainMembers, chainRowTop, defaultChain,
} from '../bubbleChain'
import type { ChainColumns } from '../bubbleChain'
import type { Rect } from '../panelGeometry'
import type { BubbleChain, BubbleTransform } from './types'

// Where a conversation's rows will land, for the editor to draw a frame around.
//
// This exists because of the one thing the editor could not show: chains render *flat* in
// edit mode — each template at its own placement, saying its own words — so that both stay
// selectable, which means the table the reader actually sees is drawn nowhere the author
// can see it. Dragging a template and setting `rows` were therefore edits with invisible
// results, and the table looked like it disagreed with what shipped.
//
// A frame is the honest fix rather than rendering the conversation: the templates keep
// their placements and their click targets, and the extent they imply is drawn as chrome
// beside them. It is an *estimate* — the real rows are as wide as their messages and as
// tall as their lettering wraps, neither of which exists until there is a transcript — so
// it is measured from a column-width balloon per row, which is the widest a row gets.

/** A conversation's extent over its panel box, in the same % units a bubble is placed in. */
export interface ChainBox {
  /** Distance from the panel box's top edge down to the table's ceiling, in %. */
  top: number
  /** Distance from the panel box's right edge in to the table's right edge, in %. */
  right: number
  /** The table's width, in % of the panel box's width. */
  width: number
  /** The table's height, in % of the panel box's height. */
  height: number
}

/**
 * The box `rows` rows will occupy, given the two templates they are stamped from.
 *
 * Horizontally it is simply the two columns' outer edges — the sender's right edge and the
 * recipient's left one — because a row never leaves the column it belongs to.
 *
 * Vertically it climbs, which is the part worth stating: rows anchor at the sender's own
 * `top` and stack **upward** from it (`.claude/rules/skin-comic-book.md`, "Only up"), so
 * the template is the table's *floor* and the ceiling is however far `rows` of balloons
 * reach above it. That is why moving the sender down lengthens nothing and moving it up
 * pushes the whole conversation off the panel — the behaviour this frame makes visible.
 */
export function chainTableBox(
  cols: ChainColumns,
  rows: number,
  panelAspect: number,
): ChainBox {
  const right = Math.min(cols.me.right, cols.them.right)
  const span = Math.max(cols.me.right + cols.me.width, cols.them.right + cols.them.width)
  // Every row is measured at its column's full width: a row is only ever narrower than
  // that (`messageWidth`), so a frame drawn this way contains the conversation rather than
  // cropping it, which is the right way for an estimate to be wrong.
  const rowWidth = Math.max(cols.me.width, cols.them.width)
  const bottom = cols.me.top + bubbleHeightPct(cols.me.width, panelAspect)
  let top = cols.me.top
  for (let i = 1; i < Math.max(1, Math.round(rows)); i += 1) {
    top = chainRowTop({ top, width: rowWidth }, rowWidth, panelAspect)
  }
  return { top, right, width: span - right, height: bottom - top }
}

/** Place a {@link ChainBox} against a panel's on-screen box, in viewport px. */
export function chainBoxRect(bounds: Rect, box: ChainBox): Rect {
  return {
    x: bounds.x + (bounds.w * (100 - box.right - box.width)) / 100,
    y: bounds.y + (bounds.h * box.top) / 100,
    w: (bounds.w * box.width) / 100,
    h: (bounds.h * box.height) / 100,
  }
}

/** One conversation's frame: the chain it belongs to, and where to draw it. */
export interface ChainFrame {
  id: string
  rect: Rect
}

/**
 * A frame per conversation drawn on `panel`. The panel's aspect comes from its on-screen
 * box rather than from a measured element, because that is the same ratio
 * `PanelBubbleChain` measures — a panel is a panel whether the editor is up or not.
 */
export function chainFramesOn(
  bubbles: readonly BubbleTransform[],
  chains: readonly BubbleChain[],
  panel: number,
  bounds: Rect,
): ChainFrame[] {
  const panelAspect = bounds.h > 0 ? bounds.w / bounds.h : 1
  const frames: ChainFrame[] = []
  for (const id of chainIdsOn(bubbles, panel)) {
    const cols = chainColumns(chainMembers(bubbles, id, panel).map(i => bubbles[i]))
    if (!cols) continue
    const chain = chains.find(c => c.id === id) ?? defaultChain(id)
    frames.push({ id, rect: chainBoxRect(bounds, chainTableBox(cols, chain.rows, panelAspect)) })
  }
  return frames
}
