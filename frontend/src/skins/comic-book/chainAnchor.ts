import { BUBBLE_ASPECT, BUBBLE_VIEW, ELLIPSE, tailTip } from './bubbleBox'
import type { TailDir } from './bubbleBox'
import type { BubbleTransform } from './editor/types'

// Where the balloon still talking on each side of a conversation is drawn: on the point
// the author aimed its template at.
//
// A chain's two templates are placed by hand, and what the author places is the *tail*
// — dragged until it points at a character's mouth. A row stamped from that template is
// as wide as its words and as tall as they wrap (bubbleFit.ts), so it is rarely the
// template's size, and a balloon hung from the template's `top`/`right` corner would
// carry its tip somewhere else with every message. So the newest row of each side is
// placed by its anchor instead: the tip of its tail, or the centre of its ellipse when it
// has none. It grows and shrinks around that point, and the tail keeps pointing where the
// author pointed it. Pure geometry, in the panel box's % units; `placeRows` in
// bubbleChain.ts is what calls it.

/** A point on the panel: x in % of the box width, y in % of its height — `top`'s units. */
export type PanelPoint = [number, number]

/** What fixes a balloon's anchor relative to its own box. */
type Anchored = Pick<BubbleTransform, 'width' | 'rotate' | 'tail'>

/**
 * The point a balloon is drawn about, in its outline's viewBox: the tip of its tail, or
 * the centre of its ellipse when it has none. The ellipse rather than the box, because
 * the box is padded below the ellipse for a tail that is not there.
 */
export function anchorPoint(tail: TailDir): [number, number] {
  return tail === 'none' ? [ELLIPSE.cx, ELLIPSE.cy] : tailTip(tail)
}

/**
 * The anchor's offset from the balloon's box centre, in % of the panel width on both
 * axes — the one isotropic unit, which is what lets the rotation be a rotation. The
 * balloon turns about its box centre (`transform-origin: center`, bubbles.css), and its
 * outline is stretched to `stretch` times its aspect before it turns, so the offset is
 * scaled first and rotated after.
 */
function anchorOffset(b: Anchored, stretch: number): [number, number] {
  const [ax, ay] = anchorPoint(b.tail)
  const lx = (ax / BUBBLE_VIEW.w - 0.5) * b.width
  const ly = (ay / BUBBLE_VIEW.h - 0.5) * b.width * BUBBLE_ASPECT * stretch
  const rad = (b.rotate * Math.PI) / 180
  return [
    lx * Math.cos(rad) - ly * Math.sin(rad),
    lx * Math.sin(rad) + ly * Math.cos(rad),
  ]
}

/** Where a placed balloon's anchor lands on the panel. */
export function anchorOf(
  b: Anchored & Pick<BubbleTransform, 'top' | 'right'>,
  panelAspect: number,
  stretch = 1,
): PanelPoint {
  const [dx, dy] = anchorOffset(b, stretch)
  const cx = 100 - b.right - b.width / 2
  const cy = b.top / panelAspect + (b.width * BUBBLE_ASPECT * stretch) / 2
  return [cx + dx, (cy + dy) * panelAspect]
}

/**
 * The `top`/`right` that put a balloon's anchor on `anchor` — the inverse of
 * {@link anchorOf} for a balloon of any width and stretch, so a row fitted to its words
 * lands with its tip exactly where its template's is.
 */
export function placeOnAnchor(
  anchor: PanelPoint,
  b: Anchored,
  stretch: number,
  panelAspect: number,
): Pick<BubbleTransform, 'top' | 'right'> {
  const [dx, dy] = anchorOffset(b, stretch)
  const cx = anchor[0] - dx
  const cy = anchor[1] / panelAspect - dy
  return {
    top: (cy - (b.width * BUBBLE_ASPECT * stretch) / 2) * panelAspect,
    right: 100 - cx - b.width / 2,
  }
}
