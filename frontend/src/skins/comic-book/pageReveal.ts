import { useCallback, useRef, useState } from 'react'
import { useLoadingHold } from '../../hooks/useLoadingHold'
import { useSlowReady } from '../../hooks/useSlowLoading'

// How the page comes on screen. The comic-book paper — the Ben-Day grid with the LOADING
// legend on it — is the skin's loading screen, and `skins/context.tsx` keeps it mounted
// under the app for the skin's whole life. While the page's pictures are still settling
// this holds that screen up (`hooks/useLoadingHold.ts`) and keeps `.cb-root` clipped to
// nothing, so the paper is what shows; once they are in, the page wipes in over the
// paper along the top-left diagonal (`cb-page-wipe`, comic-book.css), and the hold is
// kept through the wipe so the legend is covered by the page rather than taken down in
// front of it. The paper stays showing in the letterbox around the page sheet.
//
// The dev editor's "Loading screen" preview is the same two states: previewing hides
// the page and holds the paper, and leaving the preview wipes the page back in.

/**
 * Count only drawn pictures, reporting each load or error through `markSettled`. A page
 * with no pictures has no events to wait for. `ms` is the `?slow=1` hold, a parameter
 * so a test can set it without a URL.
 */
export function usePageReady(imgCount: number, ms?: number) {
    const settledCountRef = useRef(0)
    const [loaded, setLoaded] = useState(false)
    const markSettled = useCallback(() => {
        settledCountRef.current += 1
        if (settledCountRef.current >= imgCount) setLoaded(true)
    }, [imgCount])
    const ready = useSlowReady(loaded || imgCount === 0, ms)
    return [ready, markSettled] as const
}

/** The name of the wipe's `@keyframes`, which is how its `animationend` is told apart. */
export const PAGE_WIPE_ANIMATION = 'cb-page-wipe'

/** Everything Layout needs to show, hide and wipe in the page. */
export interface PageReveal {
    /** The page is on screen or coming on; false clips `.cb-root` to nothing. */
    revealed: boolean
    /** The wipe is playing: `.cb-root` carries the `cb-page-wipe` animation. */
    wiping: boolean
    /** `.cb-root`'s `animationend`, which every animation inside it bubbles up to. */
    onAnimationEnd(animationName: string): void
    /** Dev editor: whether the loading-screen preview is on. */
    previewLoading: boolean
    /** Dev editor toggle — leaving the preview wipes the page in again. */
    handlePreviewLoading(on: boolean): void
}

/**
 * The page's reveal, from `ready` — every picture on it has loaded or errored — and the
 * editor's preview toggle. The wipe starts on every rise of `revealed`, the first render
 * included, so a page with nothing to wait for still comes in over the paper.
 */
export function usePageReveal(ready: boolean): PageReveal {
    const [previewLoading, setPreviewLoading] = useState(false)
    const revealed = ready && !previewLoading

    // The wipe is started from the render that reveals, not from an effect after it,
    // so no frame is painted with the page whole before the wipe clips it back.
    const [wasRevealed, setWasRevealed] = useState(revealed)
    const [wiping, setWiping] = useState(revealed)
    if (revealed !== wasRevealed) {
        setWasRevealed(revealed)
        setWiping(revealed)
    }

    useLoadingHold(!revealed || wiping)

    const onAnimationEnd = useCallback((animationName: string) => {
        if (animationName === PAGE_WIPE_ANIMATION) setWiping(false)
    }, [])

    return { revealed, wiping, onAnimationEnd, previewLoading, handlePreviewLoading: setPreviewLoading }
}
