import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { EMPTY_TRANSCRIPT } from '../../lib/callTranscript'
import ComicPanel from '../../skins/comic-book/ComicPanel'
import { NEW_BUBBLE, NEW_CALL_LINE, newCallArt } from '../../skins/comic-book/editor/configSeed'
import type {
  BubbleTransform,
  CallSceneLayout,
  ImgTransform,
} from '../../skins/comic-book/editor/types'
import type { CallScene, PhoneActionHandlers } from '../../skins/comic-book/phoneActions'
import { idleSms } from './smsStub'

// The 'number-hangup' kind: the number on the line lettered where a dial-call balloon
// letters its field, with the telephone's red key at the right. The mirror image of
// BubbleDialCall.test.tsx, and read the same way — through ComicPanel, because the number
// it falls back to in the editor is the *panel's* dialled number, which nothing below the
// panel owns.

const PANEL = 1
const INFO = { label: 'Switchboard', isLogo: false, path: '/phone-lines', page: 'classic' as const }
const POLY = {
  vp: [[0, 0], [200, 0], [200, 100], [0, 100]] as [number, number][],
  bounds: { x: 0, y: 0, w: 200, h: 100 },
}
const SCENE: CallSceneLayout = { panel: PANEL, cut: 50, axis: 'x' }
const IMAGES: ImgTransform[] = [
  { ...newCallArt('ringing'), panel: PANEL },
  { ...newCallArt('local'), panel: PANEL },
]
const LINE: BubbleTransform = { ...NEW_CALL_LINE, panel: PANEL, call: 'local' }

const scene = (party: string, phase: CallScene['phase'] = 'ringing'): CallScene => ({
  phase, transcript: EMPTY_TRANSCRIPT, party,
})

beforeEach(() => vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']))
afterEach(() => vi.restoreAllMocks())

interface DrawOptions {
  call: CallScene
  bubbles?: BubbleTransform[]
  phoneActions?: PhoneActionHandlers
  editing?: boolean
}

function draw({ call, bubbles = [LINE], phoneActions, editing = false }: DrawOptions) {
  render(
    <MemoryRouter initialEntries={['/']}>
      <ComicPanel
        index={PANEL}
        info={INFO}
        poly={POLY}
        images={IMAGES}
        bubbles={bubbles}
        chains={[]}
        callScenes={[SCENE]}
        sms={idleSms()}
        natSizes={{}}
        editorActive={editing}
        hovered
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
  return {
    number: () => screen.getByLabelText('On the line').textContent,
    key: () => screen.getByRole('button', { name: 'End call' }) as HTMLButtonElement,
  }
}

describe('the number on the line', () => {
  it('is the call’s party, formatted the way the dial letters a number', () => {
    expect(draw({ call: scene('4388762750') }).number()).toBe('(438) 876-2750')
  })

  it('is not a field: nothing to type into mid-call', () => {
    draw({ call: scene('4388762750') })
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(document.querySelector('.cb-wheel-track')).toBeNull()
  })

  it('falls back to what the panel has dialled when the call names nobody', () => {
    // The editor's synthetic scene has no party, and a number-shaped placeholder would be
    // sample data in the bundle. The panel's own dial is the author's number, already in
    // the config, and the number that *would* be on the line if dialled from here.
    const dial: BubbleTransform = {
      ...NEW_BUBBLE, panel: PANEL, content: 'dial-call', text: '5550001111',
    }
    const { number } = draw({ call: scene(''), bubbles: [dial, LINE] })
    expect(number()).toBe('(555) 000-1111')
  })

  it('stays with the call’s party once there is one, whatever the dial says', () => {
    // An answered inbound call is with the caller, not with whoever the dial was left on.
    const dial: BubbleTransform = {
      ...NEW_BUBBLE, panel: PANEL, content: 'dial-call', text: '5550001111',
    }
    const { number } = draw({ call: scene('9998887777', 'connected'), bubbles: [dial, LINE] })
    expect(number()).toBe('(999) 888-7777')
  })
})

describe('the red key beside it', () => {
  it('hangs up through the handset’s handler', () => {
    const hangup = vi.fn()
    const { key } = draw({
      call: scene('4388762750'),
      phoneActions: { hangup: { run: hangup, disabled: false } },
    })
    expect(key().disabled).toBe(false)
    fireEvent.click(key())
    expect(hangup).toHaveBeenCalledTimes(1)
  })

  it('is greyed while the telephone has nothing for it to do', () => {
    const { key } = draw({
      call: scene('4388762750'),
      phoneActions: { hangup: { run: vi.fn(), disabled: true } },
    })
    expect(key().disabled).toBe(true)
  })

  it('is drawn but dead with no telephone behind it, and in edit mode', () => {
    // A key vanishing off a photographed telephone reads as a fault in the picture, so it
    // is disabled rather than hidden — and the overlay owns the pointer in the editor.
    expect(draw({ call: scene('4388762750') }).key().disabled).toBe(true)
    document.body.innerHTML = ''
    const { key } = draw({
      call: scene('4388762750'),
      phoneActions: { hangup: { run: vi.fn(), disabled: false } },
      editing: true,
    })
    expect(key().disabled).toBe(true)
  })
})
