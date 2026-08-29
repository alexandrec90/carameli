import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { CallTranscript } from '../../lib/callTranscript'
import { EMPTY_TRANSCRIPT } from '../../lib/callTranscript'
import { CALL_SCENE_ALT } from '../../skins/comic-book/callScene'
import ComicPanel from '../../skins/comic-book/ComicPanel'
import { NEW_BUBBLE } from '../../skins/comic-book/editor/configSeed'
import type { BubbleTransform } from '../../skins/comic-book/editor/types'
import type { CallScene } from '../../skins/comic-book/phoneActions'
import { idleSms } from './smsStub'

const HANDSET: BubbleTransform = { ...NEW_BUBBLE, panel: 1, content: 'actions', text: 'Call, End call' }

const TALK: CallTranscript = {
  lines: [
    { id: '1', speaker: 'remote', text: 'Hello?' },
    { id: '2', speaker: 'local', text: 'Where are you?' },
    { id: '3', speaker: 'remote', text: 'The office.' },
  ],
  speaking: 'remote',
}

interface DrawOptions {
  call?: CallScene | null
  bubbles?: BubbleTransform[]
  hovered?: boolean
  editorActive?: boolean
}

function draw({ call = null, bubbles = [HANDSET], hovered = false, editorActive = false }: DrawOptions) {
  const { container } = render(
    <MemoryRouter initialEntries={['/']}>
      <ComicPanel
        index={1}
        info={{ label: 'Notepad', isLogo: false, page: 'classic' }}
        poly={{
          vp: [[0, 0], [200, 0], [200, 100], [0, 100]],
          bounds: { x: 0, y: 0, w: 200, h: 100 },
        }}
        images={[]}
        bubbles={bubbles}
        chains={[]}
        sms={idleSms()}
        natSizes={{}}
        editorActive={editorActive}
        hovered={hovered}
        isRevealed={() => false}
        isBubbleVisible={() => true}
        call={call}
        dotRef={() => undefined}
        onSettled={() => undefined}
        onNatSize={() => undefined}
      />
    </MemoryRouter>,
  )
  return {
    panel: container.querySelector('.cb-panel') as HTMLDivElement,
    halves: () => Array.from(container.querySelectorAll<HTMLElement>('.cb-call-half')),
    bubbles: () => Array.from(container.querySelectorAll<HTMLElement>('.cb-call-bubble')),
  }
}

const ringing = (onEnd = vi.fn()): CallScene => ({ phase: 'ringing', transcript: EMPTY_TRANSCRIPT, onEnd })
const connected = (transcript: CallTranscript, onEnd = vi.fn()): CallScene => ({
  phase: 'connected',
  transcript,
  onEnd,
})

describe('ComicPanel with a call up', () => {
  it('keeps the telephone until a call is placed', () => {
    const { halves, panel } = draw({ call: null })
    expect(halves()).toHaveLength(0)
    expect(panel.classList.contains('cb-panel-call')).toBe(false)
    // The handset's own balloon is still there to dial from.
    expect(screen.getByRole('button', { name: 'End call' }).closest('.cb-call-half')).toBeNull()
  })

  it('splits into the far end ringing and the caller, with one balloon holding the red key', () => {
    const onEnd = vi.fn()
    const { halves, bubbles, panel } = draw({ call: ringing(onEnd) })
    expect(panel.classList.contains('cb-panel-call')).toBe(true)
    expect(halves()).toHaveLength(2)

    const [left, right] = halves()
    expect(left.querySelector('img')?.getAttribute('alt')).toBe(CALL_SCENE_ALT.ringing)
    expect(right.querySelector('img')?.getAttribute('alt')).toBe(CALL_SCENE_ALT.local)
    // The ringing telephone is the one thing making a sound; the caller is waiting.
    expect(left.classList.contains('is-speaking')).toBe(true)
    expect(right.classList.contains('is-speaking')).toBe(false)

    // One balloon, no chain, and the red key lives in it.
    expect(bubbles()).toHaveLength(1)
    expect(bubbles()[0].closest('.cb-call-half')).toBe(right)
    expect(panel.querySelectorAll('.cb-bubble-chain')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'End call' }))
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('never lights from the pointer while the scene is up', () => {
    const { panel } = draw({ call: ringing(), hovered: true })
    expect(panel.classList.contains('cb-panel-hot')).toBe(false)
    expect(panel.classList.contains('cb-panel-lift')).toBe(false)
  })

  it('shows who answered, with both parties words in their own balloons', () => {
    const { halves, bubbles } = draw({ call: connected(TALK) })
    const [left, right] = halves()
    expect(left.querySelector('img')?.getAttribute('alt')).toBe(CALL_SCENE_ALT.remote)
    expect(bubbles()).toHaveLength(2)

    const theirs = screen.getByRole('log', { name: 'What they said' })
    const yours = screen.getByRole('log', { name: 'What you said' })
    expect(Array.from(theirs.querySelectorAll('p')).map(p => p.textContent)).toEqual(['Hello?', 'The office.'])
    expect(Array.from(yours.querySelectorAll('p')).map(p => p.textContent)).toEqual(['Where are you?'])
    // The transcript is a window: it scrolls rather than growing the balloon.
    expect(theirs.classList.contains('cb-call-transcript')).toBe(true)

    // Only the one talking is lit — and only their balloon is bold.
    expect(left.classList.contains('is-speaking')).toBe(true)
    expect(right.classList.contains('is-speaking')).toBe(false)
    expect(bubbles()[0].classList.contains('is-bold')).toBe(true)
    expect(bubbles()[1].classList.contains('is-bold')).toBe(false)
    // The red key stays on the caller's side, and there is exactly one.
    expect(screen.getAllByRole('button', { name: 'End call' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'End call' }).closest('.cb-call-half')).toBe(right)
  })

  it('lights the caller when it is her turn, and nobody between lines', () => {
    const { halves } = draw({ call: connected({ ...TALK, speaking: 'local' }) })
    expect(halves()[0].classList.contains('is-speaking')).toBe(false)
    expect(halves()[1].classList.contains('is-speaking')).toBe(true)

    const quiet = draw({ call: connected({ ...TALK, speaking: null }) })
    expect(quiet.halves().every(h => !h.classList.contains('is-speaking'))).toBe(true)
  })

  it('leaves the editor alone: the author is placing what the scene would cover', () => {
    const { halves } = draw({ call: ringing(), editorActive: true })
    expect(halves()).toHaveLength(0)
  })

  it('is drawn only on the panel that holds the handset', () => {
    const { halves } = draw({ call: ringing(), bubbles: [] })
    expect(halves()).toHaveLength(0)
    const elsewhere = draw({ call: ringing(), bubbles: [{ ...HANDSET, panel: 4 }] })
    expect(elsewhere.halves()).toHaveLength(0)
  })

  it('cuts the halves out of the panel polygon, a gutter apart', () => {
    const { panel, halves } = draw({ call: ringing() })
    const [left, right] = halves()
    expect(parseFloat(left.style.width) + parseFloat(right.style.width)).toBeLessThan(200)
    expect(parseFloat(right.style.left)).toBeGreaterThan(parseFloat(left.style.width))
    expect(panel.querySelectorAll('.cb-call-ink polygon')).toHaveLength(2)
    expect(panel.querySelector('.cb-call-gutter')).not.toBeNull()
  })
})
