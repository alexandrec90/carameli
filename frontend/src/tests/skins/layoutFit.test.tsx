/**
 * The page draws its balloons at the page fit (pageFit.ts): on a window wider than the
 * page ratio a balloon is held to the width it has at that ratio, the way a picture
 * contain-fitted into its frame already is. Stretched across two monitors a balloon used
 * to be taller than its panel and several times the telephone beside it.
 *
 * Rendered through Layout rather than through PanelBubbles, because Layout is where the
 * fit is applied — the one place the balloons leave the config — and a test one level
 * down would pass with the fit forgotten there.
 */

import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { UseSoftphoneResult } from '../../hooks/useSoftphone'
import { EMPTY_TRANSCRIPT } from '../../lib/callTranscript'
import { PANEL_BUBBLE_TRANSFORMS } from '../../skins/comic-book/editor/layoutConfig'
import { Layout } from '../../skins/comic-book/Layout'
import { pageFit } from '../../skins/comic-book/pageFit'
import { idleSms } from './smsStub'

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

const phoneStub = (): UseSoftphoneResult => ({
  extensions: [],
  selectedId: '',
  select: vi.fn(),
  status: 'offline',
  callStatus: 'idle',
  remoteParty: '',
  registeredAs: '',
  dialTarget: '',
  setDialTarget: vi.fn(),
  muted: false,
  error: '',
  busy: false,
  connect: vi.fn(async () => {}),
  rotateCredential: vi.fn(async () => {}),
  disconnect: vi.fn(async () => {}),
  dial: vi.fn(async () => {}),
  autoDial: vi.fn(async () => {}),
  answer: vi.fn(async () => {}),
  decline: vi.fn(async () => {}),
  hangup: vi.fn(async () => {}),
  toggleMute: vi.fn(),
  pressDigit: vi.fn(),
  transcript: EMPTY_TRANSCRIPT,
})

const { innerWidth, innerHeight } = window

function sized(w: number, h: number) {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true })
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true })
}

afterEach(() => sized(innerWidth, innerHeight))

/** The inline width, in % of the panel box, of every ordinary balloon on the home page. */
function drawnWidths(): number[] {
  const { container } = render(
    <MemoryRouter initialEntries={['/']}>
      <Layout navItems={[]} sms={idleSms()} softphone={phoneStub()}>
        {null}
      </Layout>
    </MemoryRouter>,
  )
  return Array.from(container.querySelectorAll<HTMLElement>('.cb-panel-bubble'))
    .map(el => parseFloat(el.style.width))
    .filter(w => !Number.isNaN(w))
}

/** What the config says, for the balloons a quiet home page draws. */
function authoredWidths(): number[] {
  return PANEL_BUBBLE_TRANSFORMS.filter(b => b.call === undefined).map(b => b.width)
}

describe('balloons at the page fit', () => {
  it('draws the config as authored on the window it was drawn in', () => {
    sized(1920, 1017)
    const drawn = drawnWidths()
    expect(drawn.length).toBeGreaterThan(0)
    for (const w of drawn) expect(authoredWidths()).toContain(w)
  })

  it('holds every balloon to its design-ratio size across two monitors', () => {
    sized(3840, 1000)
    const fit = pageFit(3840, 1000)
    expect(fit).toBeLessThan(1)
    const drawn = drawnWidths()
    expect(drawn.length).toBeGreaterThan(0)
    const expected = authoredWidths().map(w => w * fit)
    for (const w of drawn) {
      expect(expected.some(e => Math.abs(e - w) < 1e-6), `${w} is a fitted width`).toBe(true)
    }
  })
})
