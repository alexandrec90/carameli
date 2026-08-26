import { Fragment } from 'react'

import { chainIdsOn, chainMembers, defaultChain } from './bubbleChain'
import type { BubbleChain } from './bubbleChain'
import PanelBubble from './PanelBubble'
import PanelBubbleChain from './PanelBubbleChain'
import type { BubbleTransform } from './editor/types'

interface PanelBubblesProps {
  /** Every bubble on the page — `panel` decides which ones this panel draws. */
  bubbles: BubbleTransform[]
  /** Chain settings, one per chain name the bubbles carry. */
  chains: BubbleChain[]
  /** Index of the panel being drawn, into PANELS. */
  panel: number
  /** CSS clip-path of the panel polygon, for bubbles that don't spill. */
  clip: string
  /** Whether bubble `index` (into `bubbles`) is currently revealed. */
  isVisible(index: number): boolean
  /** False in edit mode: the editor overlay owns the pointer there. */
  interactive: boolean
  /**
   * True in edit mode. Chains are then drawn *flat* — each template at its own placement,
   * saying its own words — instead of being played as a conversation. The editor selects
   * and drags a balloon by hit-testing its transform, so a template the conversation had
   * stamped rows from, and drawn nowhere itself, would be a balloon the author cannot
   * reach.
   */
  editing: boolean
}

/**
 * The bubbles belonging to one panel. A panel may own several or none — the array is
 * filtered by `panel` rather than indexed by it, so adding a bubble in the editor is
 * an append and never has to line up with anything.
 *
 * Each bubble is placed against this panel's box by `bubbleStyle`, so it must render
 * inside the panel element even when `spill` lets its ink cross the panel edge; that
 * is why this is a fragment of siblings and not its own positioned layer.
 *
 * Bubbles naming a `chain` are pulled out of that flat list and handed to
 * PanelBubbleChain as the two templates of one SMS conversation — a table of balloons that
 * grows in and scrolls. Everything else renders exactly as it always did, which is what
 * makes chains a per-conversation opt-in rather than a change to how bubbles work.
 */
export default function PanelBubbles({
  bubbles,
  chains,
  panel,
  clip,
  isVisible,
  interactive,
  editing,
}: PanelBubblesProps) {
  const ids = editing ? [] : chainIdsOn(bubbles, panel)
  const conversations = ids.map(id => ({
    id,
    members: chainMembers(bubbles, id, panel),
    chain: chains.find(c => c.id === id) ?? defaultChain(id),
  }))
  // Indices the conversations have claimed, so the flat pass below skips them.
  const claimed = new Set(conversations.flatMap(c => c.members))

  return (
    <>
      {bubbles.map((bubble, i) => {
        if (bubble.panel !== panel || claimed.has(i)) return null
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
      {conversations.map(({ id, members, chain }) => {
        const table = (
          <PanelBubbleChain
            chain={chain}
            members={members.map(i => bubbles[i])}
            // Every member of a chain belongs to this panel, so they reveal and hide
            // together; the sender template's answer is the conversation's.
            visible={isVisible(members[0])}
            interactive={interactive}
          />
        )
        // Spill is the sender template's call for the whole conversation. A table whose
        // balloons disagreed would be clipped down one column, which reads as a rendering
        // fault rather than as a choice — and that template is the one whose tail decides
        // how far the conversation may lean off the panel in the first place.
        return bubbles[members[0]].spill ? (
          <Fragment key={id}>{table}</Fragment>
        ) : (
          <div key={id} className="cb-bubble-clip" style={{ clipPath: clip }}>
            {table}
          </div>
        )
      })}
    </>
  )
}
