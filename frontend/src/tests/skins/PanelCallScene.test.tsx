import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { CallTranscript } from '../../lib/callTranscript'
import { EMPTY_TRANSCRIPT } from '../../lib/callTranscript'
import { CALL_SCENE_ALT } from '../../skins/comic-book/callScene'
import ComicPanel from '../../skins/comic-book/ComicPanel'
import {
  newCallArt,
  NEW_CALL_END_KEY,
  NEW_CALL_TRANSCRIPT,
} from '../../skins/comic-book/editor/configSeed'
import type {
  BubbleTransform,
  CallSceneLayout,
  ImgTransform,
} from '../../skins/comic-book/editor/types'
import type { CallScene, PhoneActionHandlers } from '../../skins/comic-book/phoneActions'
import { idleSms } from './smsStub'

// The call scene, as the page draws it once it is made of ordinary entries: three
// pictures and three balloons carrying a `call` role, laid against the halves the panel's
// seam cuts. Nothing here is a component of its own any more except the seam itself, so
// this file is about the *switch* — which entries the panel draws in which layout, which
// box each is placed in, and who is lit — rather than about a scene widget.

const PANEL = 1

/** The panel's own pictures and balloons: what it draws when no call is up. */
const PLAIN_IMG: ImgTransform = { ...newCallArt('local'), panel: PANEL, call: undefined }
const PLAIN_BUBBLE: BubbleTransform = {
  ...NEW_CALL_TRANSCRIPT, panel: PANEL, content: 'text', text: 'Quiet here.', call: undefined,
}

/** The six entries `addCallScene` makes, and the seam `reconcile` derives for them. */
const CALL_IMAGES: ImgTransform[] = [
  { ...newCallArt('ringing'), panel: PANEL },
  { ...newCallArt('remote'), panel: PANEL },
  { ...newCallArt('local'), panel: PANEL },
]
const CALL_BUBBLES: BubbleTransform[] = [
  { ...NEW_CALL_TRANSCRIPT, panel: PANEL, call: 'remote' },
  { ...NEW_CALL_TRANSCRIPT, panel: PANEL, call: 'local' },
  { ...NEW_CALL_END_KEY, panel: PANEL, call: 'local' },
]
const SCENE: CallSceneLayout = { panel: PANEL, cut: 50, axis: 'x' }

const TALK: CallTranscript = {
  lines: [
    { id: '1', speaker: 'remote', text: 'Hello?' },
    { id: '2', speaker: 'local', text: 'Where are you?' },
    { id: '3', speaker: 'remote', text: 'The office.' },
  ],
  speaking: 'remote',
}

const ringing: CallScene = { phase: 'ringing', transcript: EMPTY_TRANSCRIPT }
const connected = (transcript: CallTranscript): CallScene => ({ phase: 'connected', transcript })

interface DrawOptions {
  call?: CallScene | null
  callScenes?: CallSceneLayout[]
  images?: ImgTransform[]
  bubbles?: BubbleTransform[]
  hovered?: boolean
  editorActive?: boolean
  phoneActions?: PhoneActionHandlers
}

function draw({
  call = null,
  callScenes = [SCENE],
  images = [PLAIN_IMG, ...CALL_IMAGES],
  bubbles = [PLAIN_BUBBLE, ...CALL_BUBBLES],
  hovered = false,
  editorActive = false,
  phoneActions,
}: DrawOptions) {
  const { container } = render(
    <MemoryRouter initialEntries={['/']}>
      <ComicPanel
        index={PANEL}
        info={{ label: 'Notepad', isLogo: false, page: 'classic' }}
        poly={{
          vp: [[0, 0], [200, 0], [200, 100], [0, 100]],
          bounds: { x: 0, y: 0, w: 200, h: 100 },
        }}
        images={images}
        bubbles={bubbles}
        chains={[]}
        callScenes={callScenes}
        sms={idleSms()}
        natSizes={{}}
        editorActive={editorActive}
        hovered={hovered}
        isRevealed={() => false}
        isBubbleVisible={() => true}
        phoneActions={phoneActions}
        call={call}
        dotRef={() => undefined}
        onSettled={() => undefined}
        onNatSize={() => undefined}
      />
    </MemoryRouter>,
  )
  const slots = () => Array.from(container.querySelectorAll<HTMLElement>('.cb-call-slot'))
  return {
    container,
    panel: container.querySelector('.cb-panel') as HTMLDivElement,
    slots,
    /**
     * Every picture drawn, by its alt text — which names the role its art belongs to.
     * Pictures only: a key balloon draws an `<img>` of its own, and counting that as a
     * figure would make the red key look like a fourth party to the call.
     */
    figures: () =>
      Array.from(container.querySelectorAll('.cb-panel-img')).map(el => el.getAttribute('alt')),
    /** The slot a picture with this alt text sits in, or null when it is on the panel. */
    slotOf: (alt: string) =>
      container.querySelector(`img[alt="${alt}"]`)?.closest<HTMLElement>('.cb-call-slot') ?? null,
  }
}

describe('a panel with a call layout', () => {
  it('draws its ordinary contents while the line is quiet', () => {
    const { panel, slots, figures } = draw({ call: null })
    expect(panel.classList.contains('cb-panel-call')).toBe(false)
    expect(panel.querySelector('.cb-call-gutter')).toBeNull()
    expect(slots()).toHaveLength(0)
    // The layout switch, in one assertion: the call's six entries are simply not drawn,
    // and the panel's own are. The two sets never overlap, so nothing appears twice.
    expect(figures()).toEqual([CALL_SCENE_ALT.local])
    expect(screen.getByText('Quiet here.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'End call' })).toBeNull()
  })

  it('swaps to the call and hides the panel’s own contents once one is up', () => {
    const { panel, figures } = draw({ call: ringing })
    expect(panel.classList.contains('cb-panel-call')).toBe(true)
    expect(figures()).toEqual([CALL_SCENE_ALT.ringing, CALL_SCENE_ALT.local])
    expect(screen.queryByText('Quiet here.')).toBeNull()
  })

  it('shows the far end ringing, then the person who answered, in the same half', () => {
    // The two roles share a side so the pickup swaps the picture without moving it —
    // which is what lets an author frame one and have framed the other.
    const before = draw({ call: ringing })
    const ringingSlot = before.slotOf(CALL_SCENE_ALT.ringing) as HTMLElement
    expect(before.figures()).not.toContain(CALL_SCENE_ALT.remote)

    const after = draw({ call: connected(TALK) })
    const remoteSlot = after.slotOf(CALL_SCENE_ALT.remote) as HTMLElement
    expect(after.figures()).not.toContain(CALL_SCENE_ALT.ringing)
    expect(remoteSlot.style.left).toBe(ringingSlot.style.left)
    expect(remoteSlot.style.width).toBe(ringingSlot.style.width)
  })

  it('places each side against its own half, a gutter apart', () => {
    const { panel, slotOf } = draw({ call: ringing })
    const far = slotOf(CALL_SCENE_ALT.ringing) as HTMLElement
    const near = slotOf(CALL_SCENE_ALT.local) as HTMLElement
    const farEnd = parseFloat(far.style.left) + parseFloat(far.style.width)
    expect(parseFloat(near.style.left)).toBeGreaterThan(farEnd)
    expect(parseFloat(far.style.width) + parseFloat(near.style.width)).toBeLessThan(200)
    // The seam itself is all PanelCallScene draws: the paper, and two panels' worth of ink.
    expect(panel.querySelector('.cb-call-gutter')).not.toBeNull()
    expect(panel.querySelectorAll('.cb-call-ink polygon')).toHaveLength(2)
  })

  it('follows the seam the author moved, rather than the middle', () => {
    const { slotOf } = draw({ call: ringing, callScenes: [{ ...SCENE, cut: 25 }] })
    const far = slotOf(CALL_SCENE_ALT.ringing) as HTMLElement
    const near = slotOf(CALL_SCENE_ALT.local) as HTMLElement
    expect(parseFloat(far.style.width)).toBeLessThan(parseFloat(near.style.width))
  })

  it('turns the seam when the author turns it', () => {
    const { slotOf } = draw({ call: ringing, callScenes: [{ ...SCENE, axis: 'y' }] })
    const far = slotOf(CALL_SCENE_ALT.ringing) as HTMLElement
    const near = slotOf(CALL_SCENE_ALT.local) as HTMLElement
    // Stacked: same left edge, and the caller's half begins below the far end's.
    expect(near.style.left).toBe(far.style.left)
    expect(parseFloat(near.style.top)).toBeGreaterThan(parseFloat(far.style.top))
  })

  it('lights only the one making a sound', () => {
    const lit = (c: ReturnType<typeof draw>) =>
      Array.from(c.container.querySelectorAll('.cb-img-clip.is-speaking'))
        .map(el => el.querySelector('img')?.getAttribute('alt'))

    // A ring is the only sound there is before the pickup.
    expect(lit(draw({ call: ringing }))).toEqual([CALL_SCENE_ALT.ringing])
    expect(lit(draw({ call: connected(TALK) }))).toEqual([CALL_SCENE_ALT.remote])
    expect(lit(draw({ call: connected({ ...TALK, speaking: 'local' }) })))
      .toEqual([CALL_SCENE_ALT.local])
    expect(lit(draw({ call: connected({ ...TALK, speaking: null }) }))).toEqual([])
  })

  it('gives each party their own words, in their own half, and bolds the speaker', () => {
    const { container } = draw({ call: connected(TALK) })
    const theirs = screen.getByRole('log', { name: 'What they said' })
    const yours = screen.getByRole('log', { name: 'What you said' })
    expect(Array.from(theirs.querySelectorAll('p')).map(p => p.textContent))
      .toEqual(['Hello?', 'The office.'])
    expect(Array.from(yours.querySelectorAll('p')).map(p => p.textContent))
      .toEqual(['Where are you?'])
    // A window on the conversation, not a balloon that grows with it.
    expect(theirs.classList.contains('cb-call-transcript')).toBe(true)
    // Each transcript is in the half its own figure stands in.
    expect(theirs.closest('.cb-call-slot')).not.toBe(yours.closest('.cb-call-slot'))

    const bold = Array.from(container.querySelectorAll('.cb-panel-bubble.is-bold'))
    expect(bold).toHaveLength(1)
    expect(bold[0].contains(theirs)).toBe(true)
  })

  it('hangs up through the softphone, not through the scene', () => {
    // The red key is an ordinary `actions` balloon: the scene carries no handler of its
    // own, so there is exactly one way to end a call and one place it can fall out of step.
    const hangup = vi.fn()
    const phoneActions: PhoneActionHandlers = { hangup: { run: hangup, disabled: false } }
    const { slotOf } = draw({ call: connected(TALK), phoneActions })
    const key = screen.getByRole('button', { name: 'End call' })
    fireEvent.click(key)
    expect(hangup).toHaveBeenCalledTimes(1)
    // And it stands in the caller's half, where its role puts it. Every entry is wrapped
    // in a slot of its own — pictures and balloons are placed by separate components — so
    // "the same half" is the box the two slots are given, not one shared element.
    const keySlot = key.closest<HTMLElement>('.cb-call-slot') as HTMLElement
    expect(keySlot.getAttribute('style')).toBe(
      (slotOf(CALL_SCENE_ALT.local) as HTMLElement).getAttribute('style'),
    )
  })

  it('never lights from the pointer while a call is up', () => {
    const { panel } = draw({ call: ringing, hovered: true })
    expect(panel.classList.contains('cb-panel-hot')).toBe(false)
    expect(panel.classList.contains('cb-panel-lift')).toBe(false)
  })

  it('draws nothing of a call on a panel that has no call layout', () => {
    // The page's call reaches every panel; only the ones an author cut in two draw it.
    const { panel, slots, figures } = draw({ call: ringing, callScenes: [] })
    expect(panel.classList.contains('cb-panel-call')).toBe(false)
    expect(slots()).toHaveLength(0)
    expect(figures()).toEqual([CALL_SCENE_ALT.local])
  })

  it('draws the call in the editor too, which is what makes it editable', () => {
    // The switch is `call`, never `editorActive`: Layout hands the editor a synthetic
    // scene, and a panel that asked whether the editor was up could not be laid out in it.
    const { panel, slots } = draw({ call: ringing, editorActive: true })
    expect(panel.classList.contains('cb-panel-call')).toBe(true)
    expect(slots().length).toBeGreaterThan(0)
  })
})
