import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Skin } from '../../skins/types'

// The comic-book chunk, resolvable from the test: the paper is up while it is pending,
// and what happens when it lands is what these tests are about.
const chunk = vi.hoisted(() => {
  let resolve: (skin: { default: Skin }) => void = () => {}
  const promise = new Promise<{ default: Skin }>(r => { resolve = r })
  return { promise, land: () => resolve({ default: { Layout: () => null, views: {} } as unknown as Skin }) }
})

vi.mock('../../skins/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../skins/registry')>()
  return {
    ...actual,
    skinLoaders: { ...actual.skinLoaders, 'comic-book': () => chunk.promise },
  }
})

import { useLoadingHold } from '../../hooks/useLoadingHold'
import { LEGEND_DELAY_MS } from '../../skins/context'
import { SkinProvider } from '../../skins/context'

// The comic-book paper outlives the chunk gate. What is pinned: the same canvas is
// under the page before and after the chunk lands, the legend stays up — the same node,
// never re-mounted — across the handoff to a gate below that holds, and it comes down
// once nothing holds.

/** `App` while the session is on its way: holds and draws nothing. */
function Gate({ open }: { open: boolean }) {
  useLoadingHold(!open)
  return open ? <div>page</div> : null
}

let realGetContext: HTMLCanvasElement['getContext']

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  realGetContext = HTMLCanvasElement.prototype.getContext
  HTMLCanvasElement.prototype.getContext = (() => ({
    fillStyle: '', clearRect: () => {}, fillRect: () => {}, beginPath: () => {},
    moveTo: () => {}, arc: () => {}, fill: () => {},
  })) as unknown as HTMLCanvasElement['getContext']
  localStorage.setItem('skin', 'comic-book')
})

afterEach(() => {
  vi.useRealTimers()
  HTMLCanvasElement.prototype.getContext = realGetContext
  localStorage.clear()
})

function renderPaper(open: boolean) {
  return render(
    <MemoryRouter>
      <SkinProvider><Gate open={open} /></SkinProvider>
    </MemoryRouter>,
  )
}

const legend = () => screen.queryByText('LOADING')

describe('the comic-book paper', () => {
  it('keeps the one canvas under the page when the chunk lands', async () => {
    const { container } = renderPaper(true)
    const canvas = container.querySelector('canvas')
    expect(canvas).not.toBeNull()
    expect(screen.queryByText('page')).toBeNull()

    await act(async () => { chunk.land(); await chunk.promise })

    expect(screen.getByText('page')).not.toBeNull()
    expect(container.querySelector('canvas')).toBe(canvas)
  })

  it('carries the legend across the handoff to a gate that holds, as the same node', async () => {
    renderPaper(false)
    act(() => { vi.advanceTimersByTime(LEGEND_DELAY_MS) })
    const before = legend()
    expect(before).not.toBeNull()

    await act(async () => { chunk.land(); await chunk.promise })
    act(() => { vi.advanceTimersByTime(0) })

    // Still up, and the element it was: it was never taken down and popped up again.
    expect(legend()).toBe(before)
  })

  it('takes the legend down once nothing below holds', async () => {
    const view = renderPaper(false)
    act(() => { vi.advanceTimersByTime(LEGEND_DELAY_MS) })
    await act(async () => { chunk.land(); await chunk.promise })
    expect(legend()).not.toBeNull()

    view.rerender(
      <MemoryRouter>
        <SkinProvider><Gate open /></SkinProvider>
      </MemoryRouter>,
    )
    act(() => { vi.advanceTimersByTime(0) })
    expect(legend()).toBeNull()
    // And the paper itself is still there under the page.
    expect(view.container.querySelector('canvas')).not.toBeNull()
  })

  it('shows no legend on a load that is done inside the delay', async () => {
    renderPaper(true)
    await act(async () => { chunk.land(); await chunk.promise })
    act(() => { vi.advanceTimersByTime(LEGEND_DELAY_MS) })
    expect(legend()).toBeNull()
  })
})
