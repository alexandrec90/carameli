import { act, render, renderHook } from '@testing-library/react'
import { Suspense, useEffect } from 'react'
import { describe, expect, it } from 'vitest'

import {
  holdLoading,
  isLoadingHeld,
  LoadingHold,
  useLoadingHeld,
  useLoadingHold,
} from '../../hooks/useLoadingHold'

// The store a persistent loading screen reads and the gates below it write. What is
// pinned: a hold counts until its release, a release counts once, the screen re-renders
// as the count crosses zero, and a hold taken by a component mounting in the same
// commit that dropped the previous one is already counted when that commit's passive
// effects run — the property the comic-book legend's continuity rests on.

function Holder({ active }: { active: boolean }) {
  useLoadingHold(active)
  return null
}

function Screen() {
  return <output>{useLoadingHeld() ? 'held' : 'free'}</output>
}

describe('holdLoading', () => {
  it('counts holds until each is released, and a release only once', () => {
    expect(isLoadingHeld()).toBe(false)
    const releaseA = holdLoading()
    const releaseB = holdLoading()
    expect(isLoadingHeld()).toBe(true)
    releaseA()
    releaseA()
    expect(isLoadingHeld()).toBe(true)
    releaseB()
    expect(isLoadingHeld()).toBe(false)
  })
})

describe('useLoadingHold / useLoadingHeld', () => {
  it('is free with nothing mounted that holds', () => {
    const { result } = renderHook(() => useLoadingHeld())
    expect(result.current).toBe(false)
  })

  it('re-renders the screen as holders come and go', () => {
    const view = render(<><Screen /><Holder active /></>)
    expect(view.getByRole('status').textContent).toBe('held')

    view.rerender(<><Screen /><Holder active={false} /></>)
    expect(view.getByRole('status').textContent).toBe('free')

    view.rerender(<><Screen /><Holder active /></>)
    expect(view.getByRole('status').textContent).toBe('held')

    view.unmount()
    expect(isLoadingHeld()).toBe(false)
  })

  it('is held while any of several holders is, and free once all have gone', () => {
    const view = render(<><Screen /><Holder active /><Holder active /></>)
    view.rerender(<><Screen /><Holder active={false} /><Holder active /></>)
    expect(view.getByRole('status').textContent).toBe('held')
    view.rerender(<><Screen /><Holder active={false} /><Holder active={false} /></>)
    expect(view.getByRole('status').textContent).toBe('free')
  })

  /* The handoff between gates. The chunk gate opens in the render that mounts `App`,
     which holds for the session; the count has to include that hold before anything
     that runs after the commit — a passive effect deciding whether to take the legend
     down — gets to look. A hold from a passive effect would be counted too late. */
  it('counts a hold taken by a newly mounted holder before passive effects run', () => {
    const seenByEffect: boolean[] = []
    function Watcher() {
      // A passive effect, as the paper's legend timer is — and mounted *before* the
      // holder, so a hold taken in a passive effect would run after this one.
      useEffect(() => { seenByEffect.push(isLoadingHeld()) }, [])
      return null
    }
    render(<><Watcher /><Holder active /></>)
    expect(seenByEffect).toEqual([true])
  })
})

describe('LoadingHold', () => {
  function Never(): null {
    // A chunk that never lands: the boundary shows its fallback for the whole test.
    throw new Promise<never>(() => {})
  }

  it('holds for as long as it is mounted as a fallback', () => {
    const view = render(
      <>
        <Screen />
        <Suspense fallback={<LoadingHold />}><Never /></Suspense>
      </>,
    )
    expect(view.getByRole('status').textContent).toBe('held')
    act(() => { view.unmount() })
    expect(isLoadingHeld()).toBe(false)
  })
})
