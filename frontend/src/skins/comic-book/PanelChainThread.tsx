import type { BubbleChain } from './bubbleChain'
import BubbleSlot from './BubbleSlot'
import type { SceneHalves } from './callSceneGeometry'
import { halfFor } from './callSceneRoles'
import PanelBubbleChain from './PanelBubbleChain'
import type { BubbleTransform } from './editor/types'
import type { Rect } from './panelGeometry'
import type { UseSmsConversationsResult } from '../../hooks/useSmsConversations'
import type { SmsConversationMessage } from '../../lib/smsConversation'

/**
 * One shared "nothing yet" array. A chain whose first poll has not landed is handed this
 * rather than a fresh `[]` per render, so its transcript keeps the same identity and the
 * balloons do not remount underneath a conversation that has not changed.
 */
const NO_MESSAGES: readonly SmsConversationMessage[] = []

interface PanelChainThreadProps {
  chain: BubbleChain
  /** The chain's balloons in order; the first is its sender template. */
  members: BubbleTransform[]
  /** The panel cut in two, while a call is up on it; null on its ordinary layout. */
  halves: SceneHalves | null
  /** Box of the panel being drawn, in viewport coords. */
  bounds: Rect
  /** CSS clip-path of the panel polygon, for a conversation that doesn't spill. */
  clip: string
  visible: boolean
  /** False in edit mode: the editor overlay owns the pointer there. */
  interactive: boolean
  keyboard: boolean
  onComposerHover: (hovered: boolean) => void
  /** The number the panel resolved, as an API takes it, or null when nothing is bound. */
  peer: string | null
  /** The reader's own spelling of that number, which is what a send reports. */
  chosen: string
  sms: UseSmsConversationsResult
  onPeerTexted?: (value: string) => void
}

/**
 * One SMS conversation on a panel: the two templates played as a table of balloons that
 * grows in and scrolls, rather than drawn where they were placed.
 *
 * **This is where a chain stops being a drawing.** Bound only when the author asked for it
 * *and* the panel resolved a number; a chain that asked and got nothing shows an empty
 * conversation rather than falling back to the authored transcript, because the fallback
 * would put words in a real thread.
 */
export default function PanelChainThread({
  chain,
  members,
  halves,
  bounds,
  clip,
  visible,
  interactive,
  keyboard,
  onComposerHover,
  peer,
  chosen,
  sms,
  onPeerTexted,
}: PanelChainThreadProps) {
  const live = chain.sms && peer !== null
  // Spill is the sender template's call for the whole conversation. A table whose balloons
  // disagreed would be clipped down one column, which reads as a rendering fault rather
  // than as a choice — and that template is the one whose tail decides how far the
  // conversation may lean off the panel in the first place. Its half is the
  // conversation's too, for the same reason.
  const sender = members[0]

  return (
    <BubbleSlot half={halfFor(sender.call, halves)} bounds={bounds} clip={clip} spill={sender.spill}>
      <PanelBubbleChain
        chain={chain}
        members={members}
        visible={visible}
        interactive={interactive}
        keyboard={keyboard}
        onComposerHover={onComposerHover}
        conversation={
          live && peer
            ? {
                messages: sms.conversations[peer] ?? NO_MESSAGES,
                typing: sms.typing[peer] === true,
                onSend: (text: string) => {
                  // The reader's own spelling of the number, not `peer`: the drum letters
                  // its rows the way the field does, and E.164 is the form the API takes
                  // rather than the one the panel shows.
                  onPeerTexted?.(chosen)
                  void sms.send(peer, text)
                },
              }
            : undefined
        }
      />
    </BubbleSlot>
  )
}
