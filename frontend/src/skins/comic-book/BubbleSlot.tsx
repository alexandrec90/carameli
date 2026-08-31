import type { ReactNode } from 'react'

import { halfSlot } from './callSceneGeometry'
import type { SceneHalf } from './callSceneGeometry'
import { toClipPath } from './editor/transforms'
import type { Rect } from './panelGeometry'

/** A half's slot, or the panel's own clip when the balloon is not in one. */
function slotClip(half: SceneHalf | null, panelClip: string): string {
  return half ? toClipPath(half.pts, half.box.x, half.box.y) : panelClip
}

interface BubbleSlotProps {
  /** The half of a call scene this belongs to, or null on the panel's ordinary layout. */
  half: SceneHalf | null
  /** Box of the panel being drawn, in viewport coords — where a half's slot sits inside it. */
  bounds: Rect
  /** CSS clip-path of the panel polygon, for content that doesn't spill. */
  clip: string
  /** Whether the ink may cross the edge it is drawn against. */
  spill?: boolean
  children: ReactNode
}

/**
 * Where one balloon — or one whole conversation — sits on the panel. Two questions, asked
 * in the same order for both: may its ink cross the edge it is drawn against, and is that
 * edge the panel's or the half's it belongs to.
 *
 * Spill off means a clip wrapper hides the overflow behind the right edge. A balloon in
 * one half of a call scene also gets a slot element at that half, and nothing else
 * changes: its percentages then resolve against the half, which is the box the author
 * framed it in.
 */
export default function BubbleSlot({
  half,
  bounds,
  clip,
  spill = false,
  children,
}: BubbleSlotProps) {
  const placed = spill ? (
    children
  ) : (
    <div className="cb-bubble-clip" style={{ clipPath: slotClip(half, clip) }}>
      {children}
    </div>
  )
  return half ? (
    <div className="cb-call-slot" style={halfSlot(half, bounds)}>
      {placed}
    </div>
  ) : (
    <>{placed}</>
  )
}
