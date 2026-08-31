import BubbleSlot from './BubbleSlot'
import { isDialContent } from './bubbleContent'
import type { SceneHalves } from './callSceneGeometry'
import { CALL_TRANSCRIPT_LABELS, callSpeaker, halfFor } from './callSceneRoles'
import PanelBubble from './PanelBubble'
import { bubbleClaim, bubbleKey, CLAIM_NONE } from './panelKeyboard'
import type { HoverReporter } from './panelKeyboard'
import type { BubbleTransform, CallRole } from './editor/types'
import type { Rect } from './panelGeometry'
import type { PhoneActionHandlers } from './phoneActions'
import { linesBy } from '../../lib/callTranscript'
import type { CallTranscript } from '../../lib/callTranscript'

interface PanelFlatBubbleProps {
  bubble: BubbleTransform
  /** Its index into the page's bubble list — what its keyboard claim is keyed under. */
  index: number
  /** The panel cut in two, while a call is up on it; null on its ordinary layout. */
  halves: SceneHalves | null
  /** Box of the panel being drawn, in viewport coords. */
  bounds: Rect
  /** CSS clip-path of the panel polygon, for a balloon that doesn't spill. */
  clip: string
  visible: boolean
  /** False in edit mode: the editor overlay owns the pointer there. */
  interactive: boolean
  /** Which claimant the panel gave its keyboard to, by key, or null when nobody has it. */
  owner: string | null
  hoverReporter: HoverReporter
  /** Index of the panel's peer picker, or -1: only that balloon reports its option. */
  pickerIndex: number
  onWheelSelect: (value: string) => void
  /** The words of the call on this panel, for a `transcript` balloon. */
  transcript?: CallTranscript
  /** Roles inked heavy right now — the speaker's. */
  lit: readonly CallRole[]
  onPhoneSubmit?: (value: string) => void
  dialValue: string
  dialFresh: boolean
  dialled: string[]
  onDialChange?: (value: string, fresh: boolean) => void
  phoneActions?: PhoneActionHandlers
}

/**
 * One balloon that is not part of a conversation — the flat case, which is most of them.
 * Everything here is a question about *this* balloon that only the panel can answer for
 * it: which half it sits in, whether it owns the keyboard, and whose words it says.
 *
 * Lifted out of PanelBubbles.tsx as a component rather than a helper because the answers
 * are props: a balloon that read the panel's state directly would be a second place the
 * layout switch is decided, and the two would drift apart the first time either changed.
 */
export default function PanelFlatBubble({
  bubble,
  index,
  halves,
  bounds,
  clip,
  visible,
  interactive,
  owner,
  hoverReporter,
  pickerIndex,
  onWheelSelect,
  transcript,
  lit,
  onPhoneSubmit,
  dialValue,
  dialFresh,
  dialled,
  onDialChange,
  phoneActions,
}: PanelFlatBubbleProps) {
  const key = bubbleKey(index)
  // A transcript's words are the call's, never the balloon's own text. The seat is the
  // role's; a transcript with no role — an author's, outside any call layout — is a
  // window on the whole conversation rather than on one side of it.
  const seat = bubble.call ? callSpeaker(bubble.call) : null
  const words = bubble.content !== 'transcript' || !transcript
    ? undefined
    : seat
      ? linesBy(transcript, seat)
      : transcript.lines

  return (
    <BubbleSlot half={halfFor(bubble.call, halves)} bounds={bounds} clip={clip} spill={bubble.spill}>
      <PanelBubble
        bubble={bubble}
        visible={visible}
        interactive={interactive}
        onWheelSelect={index === pickerIndex ? onWheelSelect : undefined}
        keyboard={owner === key}
        // Only a claimant reports: lettering under the pointer is not a balloon anybody
        // could be typing into, so it leaves the owner where it is.
        onHoverChange={bubbleClaim(bubble.content) > CLAIM_NONE ? hoverReporter(key) : undefined}
        onSubmit={
          bubble.content === 'phone' || isDialContent(bubble.content) ? onPhoneSubmit : undefined
        }
        dialValue={dialValue}
        dialFresh={dialFresh}
        dialled={dialled}
        onDialChange={onDialChange}
        actions={bubble.content === 'actions' ? phoneActions : undefined}
        lines={words}
        linesLabel={
          bubble.content === 'transcript' ? CALL_TRANSCRIPT_LABELS[bubble.call ?? 'none'] : undefined
        }
        // Heavy while its seat is talking, and only on a transcript: the words are what
        // "this voice is on the line" is about, so bolding the red key beside them would
        // say the button was speaking.
        bold={
          bubble.content === 'transcript' && bubble.call !== undefined && lit.includes(bubble.call)
        }
      />
    </BubbleSlot>
  )
}
