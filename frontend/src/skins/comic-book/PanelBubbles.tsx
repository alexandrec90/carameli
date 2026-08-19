import { Fragment } from 'react'

import PanelBubble from './PanelBubble'
import type { BubbleTransform } from './editor/types'

interface PanelBubblesProps {
  /** Every bubble on the page — `panel` decides which ones this panel draws. */
  bubbles: BubbleTransform[]
  /** Index of the panel being drawn, into PANELS. */
  panel: number
  /** CSS clip-path of the panel polygon, for bubbles that don't spill. */
  clip: string
  /** Whether bubble `index` (into `bubbles`) is currently revealed. */
  isVisible(index: number): boolean
  /** False in edit mode: the editor overlay owns the pointer there. */
  interactive: boolean
}

/**
 * The bubbles belonging to one panel. A panel may own several or none — the array is
 * filtered by `panel` rather than indexed by it, so adding a bubble in the editor is
 * an append and never has to line up with anything.
 *
 * Each bubble is placed against this panel's box by `bubbleStyle`, so it must render
 * inside the panel element even when `spill` lets its ink cross the panel edge; that
 * is why this is a fragment of siblings and not its own positioned layer.
 */
export default function PanelBubbles({
  bubbles,
  panel,
  clip,
  isVisible,
  interactive,
}: PanelBubblesProps) {
  return (
    <>
      {bubbles.map((bubble, i) => {
        if (bubble.panel !== panel) return null
        const el = (
          <PanelBubble bubble={bubble} visible={isVisible(i)} interactive={interactive} />
        )
        // spill off: a clip wrapper hides the overflow behind the panel edge.
        return bubble.spill ? (
          <Fragment key={i}>{el}</Fragment>
        ) : (
          <div key={i} className="cb-bubble-clip" style={{ clipPath: clip }}>
            {el}
          </div>
        )
      })}
    </>
  )
}
