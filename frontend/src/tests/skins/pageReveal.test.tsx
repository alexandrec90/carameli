import { act, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { isLoadingHeld } from '../../hooks/useLoadingHold'
import { useSlowReady } from '../../hooks/useSlowLoading'
import { PAGE_WIPE_ANIMATION, usePageReveal } from '../../skins/comic-book/pageReveal'
import { cssRules, SKIN_CSS } from './skinCss'

// How the page comes on screen: clipped to nothing while its pictures settle, wiped in
// over the paper once they are in, and the paper's legend held up through the wipe so
// the page covers it rather than watching it go. The paper itself is
// skinLoadingGrid.test.tsx; the pictures gate is usePageReady.test.ts.

const STYLESHEET = SKIN_CSS['src/skins/comic-book/comic-book.css']

/** Layout's own use of the hook: the root's classes and its animationend. */
function Harness({ ready }: { ready: boolean }) {
  const reveal = usePageReveal(ready)
  return (
    <div
      data-testid="root"
      className={`cb-root${reveal.revealed ? '' : ' cb-page-hidden'}${reveal.wiping ? ' cb-page-wipe' : ''}`}
      onAnimationEnd={e => reveal.onAnimationEnd(e.animationName)}
    >
      <button type="button" onClick={() => reveal.handlePreviewLoading(!reveal.previewLoading)}>
        preview
      </button>
    </div>
  )
}

/** Layout's composition under `?slow=1`: the hold in front of the reveal. */
function BrakedHarness({ ready, ms }: { ready: boolean; ms: number }) {
  return <Harness ready={useSlowReady(ready, ms)} />
}

const classesOf = (el: HTMLElement) => [...el.classList].sort()

function endAnimation(el: HTMLElement, animationName: string) {
  fireEvent.animationEnd(el, { animationName })
}

describe('usePageReveal', () => {
  it('keeps the page clipped away and the loading screen held while pictures settle', () => {
    const { getByTestId } = render(<Harness ready={false} />)
    expect(classesOf(getByTestId('root'))).toEqual(['cb-page-hidden', 'cb-root'])
    expect(isLoadingHeld()).toBe(true)
  })

  it('wipes the page in once it is ready, holding the screen until the wipe ends', () => {
    const view = render(<Harness ready={false} />)
    view.rerender(<Harness ready />)
    const root = view.getByTestId('root')
    expect(classesOf(root)).toEqual(['cb-page-wipe', 'cb-root'])
    expect(isLoadingHeld()).toBe(true)

    endAnimation(root, PAGE_WIPE_ANIMATION)
    expect(classesOf(root)).toEqual(['cb-root'])
    expect(isLoadingHeld()).toBe(false)
  })

  it('ignores the end of any other animation inside the root', () => {
    const view = render(<Harness ready />)
    const root = view.getByTestId('root')
    endAnimation(root, 'cb-bubble-arrive')
    expect(classesOf(root)).toEqual(['cb-page-wipe', 'cb-root'])
    expect(isLoadingHeld()).toBe(true)
  })

  it('wipes in a page that had nothing to wait for', () => {
    // No pictures: ready from the first render, and still the page comes in over the
    // paper rather than being there when the paper is.
    const { getByTestId } = render(<Harness ready />)
    expect(classesOf(getByTestId('root'))).toEqual(['cb-page-wipe', 'cb-root'])
  })

  it('never has the page both clipped away and wiping', () => {
    for (const ready of [false, true]) {
      const view = render(<Harness ready={ready} />)
      const classes = classesOf(view.getByTestId('root'))
      expect(classes.includes('cb-page-hidden') && classes.includes('cb-page-wipe')).toBe(false)
      view.unmount()
    }
  })

  describe('the editor\'s loading-screen preview', () => {
    it('hides the page and holds the screen, and wipes the page back in on leaving', () => {
      const view = render(<Harness ready />)
      const root = view.getByTestId('root')
      endAnimation(root, PAGE_WIPE_ANIMATION)
      expect(isLoadingHeld()).toBe(false)

      fireEvent.click(view.getByText('preview'))
      expect(classesOf(root)).toEqual(['cb-page-hidden', 'cb-root'])
      expect(isLoadingHeld()).toBe(true)

      fireEvent.click(view.getByText('preview'))
      expect(classesOf(root)).toEqual(['cb-page-wipe', 'cb-root'])
      expect(isLoadingHeld()).toBe(true)
      endAnimation(root, PAGE_WIPE_ANIMATION)
      expect(isLoadingHeld()).toBe(false)
    })

    it('cancels a wipe in flight when the preview comes on', () => {
      const view = render(<Harness ready />)
      const root = view.getByTestId('root')
      fireEvent.click(view.getByText('preview'))
      expect(classesOf(root)).toEqual(['cb-page-hidden', 'cb-root'])
    })
  })
})

// This is the gate `?slow=1` exists for: a page of cached pictures is ready inside its
// first frame, so on a warm machine the paper is on screen for no time at all and the
// wipe — the one transition the flag is turned on to watch — runs over nothing.
describe('the reveal under the `?slow=1` brake', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }) })
  afterEach(() => { vi.useRealTimers() })

  it('holds the page away for the whole brake, then wipes it in', () => {
    const view = render(<BrakedHarness ready ms={1000} />)
    const root = view.getByTestId('root')

    act(() => { vi.advanceTimersByTime(999) })
    expect(classesOf(root)).toEqual(['cb-page-hidden', 'cb-root'])
    expect(isLoadingHeld()).toBe(true)

    act(() => { vi.advanceTimersByTime(1) })
    expect(classesOf(root)).toEqual(['cb-page-wipe', 'cb-root'])
  })

  it('changes nothing with the brake off', () => {
    const { getByTestId } = render(<BrakedHarness ready ms={0} />)
    expect(classesOf(getByTestId('root'))).toEqual(['cb-page-wipe', 'cb-root'])
  })
})

// The stylesheet's half, which jsdom cannot apply: the two classes above have to mean
// what the hook assumes they mean, and the root has to let the paper show through.
describe('the wipe in comic-book.css', () => {
  const ruleFor = (selector: string) => {
    const rule = cssRules(STYLESHEET).find(r => r.selector === selector)
    expect(rule, `no \`${selector}\` rule in comic-book.css`).toBeDefined()
    return rule?.body ?? ''
  }

  it('clips a hidden page to nothing', () => {
    expect(ruleFor('.cb-page-hidden')).toMatch(/clip-path:\s*polygon\(0 0, 0 0, 0 0\)/)
  })

  it('runs the wipe as the animation the hook listens for', () => {
    expect(ruleFor('.cb-page-wipe')).toMatch(new RegExp(`animation:\\s*${PAGE_WIPE_ANIMATION}\\b`))
    expect(STYLESHEET).toMatch(new RegExp(`@keyframes ${PAGE_WIPE_ANIMATION}\\b`))
  })

  it('wipes along the top-left diagonal, from nothing to past the far corner', () => {
    const keyframes = /@keyframes cb-page-wipe\s*\{([\s\S]*?)\n\}/.exec(STYLESHEET)?.[1] ?? ''
    expect(keyframes).toMatch(/from\s*\{\s*clip-path:\s*polygon\(0 0, 0 0, 0 0\)/)
    // A triangle on the origin whose hypotenuse is x + y = 100vw + 100vh: the line
    // through the bottom-right corner, so the last thing revealed is that corner.
    expect(keyframes).toMatch(
      /to\s*\{\s*clip-path:\s*polygon\(0 0, calc\(100vw \+ 100vh\) 0, 0 calc\(100vw \+ 100vh\)\)/,
    )
  })

  it('gives the root no background, so the paper shows in the letterbox', () => {
    expect(ruleFor('.cb-root')).not.toMatch(/background/)
    expect(ruleFor('.cb-page-sheet')).toMatch(/background:\s*var\(--cb-white\)/)
  })
})
