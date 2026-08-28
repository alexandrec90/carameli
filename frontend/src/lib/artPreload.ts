/**
 * Audit of the panel art the skin guard in `index.html` fetches ahead of the app.
 *
 * The guard downloads one page's comic-book panels from `<head>`, before the entry
 * module is even requested. Whether the page then *draws* them is a different
 * question, and the browser is the wrong place to ask it: Chrome used to answer with
 * "was preloaded using link preload but not used within a few seconds from the
 * window's load event", once per file, which is true of a genuinely wrong PANELS list
 * and equally true of a dev boot where the chunk that draws the art simply arrived
 * four seconds in. The two need telling apart, and only the first is a defect.
 *
 * So the guard fetches with an `Image` — its own consumer, so nothing warns — and this
 * module asks the question once the page has settled, with a window long enough that
 * an answer means something. What it finds goes through {@link logger}, which ships it
 * to the server-side log alongside backend events, so the next person to look does not
 * have to have had the console open at the time.
 */

import { DEFAULT_SKIN, resolveSkinName } from '../skins/registry'
import { logger } from './logger'

/** The record the inline guard in `index.html` leaves on `window` for this module. */
export interface ArtPreload {
  /** Which list was fetched — the `home` grid or the `classic` one. */
  page: string
  /** The URLs the guard asked for, in fetch order. */
  urls: string[]
  /** `performance.now()` at which each URL finished downloading, keyed by URL. */
  settled: Record<string, number>
  /** URLs whose fetch failed outright — a 404 panel, or a name that has drifted. */
  failed: string[]
  /** The `Image` objects themselves, held so the bytes stay in the memory cache. */
  images: HTMLImageElement[]
}

declare global {
  interface Window {
    __carameliArt?: ArtPreload
  }
}

/**
 * How long after the load event the audit looks.
 *
 * Chrome's own warning fires at about three seconds, which is inside the range a cold
 * dev boot takes to render the first panel — that is exactly why its message could not
 * be acted on. Ten seconds is past anything a render legitimately takes, so art still
 * undrawn at that point is undrawn because nothing on the page draws it.
 */
export const ART_AUDIT_DELAY_MS = 10_000

/** Absolute form of a URL, so `%20` and a leading `/` compare as one thing. */
function absolute(url: string, base: string): string {
  try {
    return new URL(url, base).href
  } catch {
    return url
  }
}

/** What the audit found: art nothing drew, and art that never arrived. */
export interface ArtAuditFindings {
  unused: string[]
  failed: string[]
}

/**
 * The preloaded URLs no rendered image is showing, plus the ones that failed.
 *
 * Pure, and exported for its test: the browser gives no second chance to observe this
 * — by the time a wrong list shows up as a blank panel in a screenshot, the load it
 * cost is long over.
 */
export function artAuditFindings(
  art: ArtPreload,
  rendered: string[],
  base: string,
): ArtAuditFindings {
  const drawn = new Set(rendered.map(url => absolute(url, base)))
  return {
    unused: art.urls.filter(url => !drawn.has(absolute(url, base))),
    failed: [...art.failed],
  }
}

/** The stored skin, resolved the way `App.tsx` resolves it. */
function currentSkin(win: Window): string {
  try {
    return resolveSkinName(win.localStorage.getItem('skin') ?? DEFAULT_SKIN)
  } catch {
    // Safari in private mode throws rather than returning null, same as in the guard.
    return DEFAULT_SKIN
  }
}

/**
 * Report, once, on the art the guard fetched for this page load.
 *
 * Reports nothing when the visitor has switched skin since the load: the art was
 * fetched for comic-book and another skin not drawing it is the system working, not a
 * drifted list. Silent when everything the guard fetched is on the page, which is the
 * ordinary case — this exists to be quiet until it isn't.
 */
export function auditArtPreload(win: Window = window, delayMs: number = ART_AUDIT_DELAY_MS): void {
  const art = win.__carameliArt
  if (!art) return

  const check = (): void => {
    if (currentSkin(win) !== 'comic-book') return
    // `querySelectorAll` rather than `document.images`: the collection is the same one
    // and the query is the spelling every DOM implementation this runs under has.
    const drawn = win.document.querySelectorAll('img')
    const rendered = Array.from(drawn, img => img.currentSrc || img.src)
    const { unused, failed } = artAuditFindings(art, rendered, win.location.href)
    const where = { page: art.page, path: win.location.pathname, preloaded: art.urls.length }

    if (failed.length > 0) {
      logger.warn('Preloaded panel art failed to load', { ...where, failed })
    }
    if (unused.length > 0) {
      logger.warn('Preloaded panel art was never drawn', {
        ...where,
        unused,
        secondsWaited: delayMs / 1000,
        hint:
          "index.html's PANELS list for this page names art the page does not draw. " +
          'Reconcile it with PANEL_IMG_TRANSFORMS in ' +
          'src/skins/comic-book/editor/layoutConfig.ts.',
      })
    }
  }

  const start = (): void => {
    win.setTimeout(check, delayMs)
  }
  if (win.document.readyState === 'complete') start()
  else win.addEventListener('load', start, { once: true })
}
