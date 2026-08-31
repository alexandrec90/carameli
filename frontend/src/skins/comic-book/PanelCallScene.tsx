import type { SceneHalves } from './callSceneGeometry'
import { toClipPath } from './editor/transforms'
import { HALF_GUTTER } from './panelGeometry'
import type { Rect, VpPt } from './panelGeometry'

/** SVG `points` for a viewport polygon, relative to the panel box. */
const pointsOf = (pts: readonly VpPt[], bounds: Rect): string =>
  pts.map(([x, y]) => `${x - bounds.x},${y - bounds.y}`).join(' ')

interface PanelCallSceneProps {
  /** The panel's box: this chrome is positioned inside the panel element, relative to it. */
  bounds: Rect
  /** The panel's own polygon, for the paper the gutter is cut out of. */
  vp: readonly VpPt[]
  halves: SceneHalves
}

/**
 * The seam a call puts across a panel: the paper between the two halves, and the ink
 * around each of them.
 *
 * That is the whole of it. The people, the words and the red key are ordinary pictures
 * and balloons carrying a `call` role — drawn by PanelImages and PanelBubbles against the
 * half their role names, so every one of them is placed, sized and restyled in the editor
 * like anything else on the page. What is left here is the part no author can express as
 * a transform: two panels' worth of ink where the grid drew one.
 *
 * Inked like two panels, so the scene reads as the page having gained a seam rather than
 * as a picture pasted over one.
 */
export default function PanelCallScene({ bounds, vp, halves }: PanelCallSceneProps) {
  const gutterStart = halves.at - HALF_GUTTER
  const across = halves.axis === 'x'

  return (
    <>
      {/* Paper between the halves: the dots canvas under the scene is clipped to the
          whole panel, and a gutter is paper, not dots. Clipped to the panel polygon so
          it stops where the panel's ink runs. */}
      <div
        className="cb-call-gutter"
        style={
          across
            ? {
                left: gutterStart - bounds.x,
                top: 0,
                width: HALF_GUTTER * 2,
                height: '100%',
                clipPath: toClipPath([...vp], gutterStart, bounds.y),
              }
            : {
                left: 0,
                top: gutterStart - bounds.y,
                width: '100%',
                height: HALF_GUTTER * 2,
                clipPath: toClipPath([...vp], bounds.x, gutterStart),
              }
        }
      />
      {/* The halves' ink — one stroked polygon each, the way PanelInk strokes a panel. */}
      <svg className="cb-call-ink" viewBox={`0 0 ${bounds.w} ${bounds.h}`} aria-hidden="true">
        <polygon points={pointsOf(halves.a.pts, bounds)} />
        <polygon points={pointsOf(halves.b.pts, bounds)} />
      </svg>
    </>
  )
}
