import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ART_AUDIT_DELAY_MS,
  artAuditFindings,
  auditArtPreload,
  type ArtPreload,
} from '../../lib/artPreload'
import { logger } from '../../lib/logger'

const BASE = 'http://localhost:5173/'

function preload(overrides: Partial<ArtPreload> = {}): ArtPreload {
  return {
    page: 'home',
    urls: ['/comic-book/logo2.webp', '/comic-book/conversation.webp'],
    settled: {},
    failed: [],
    images: [],
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  delete window.__carameliArt
  document.body.innerHTML = ''
  localStorage.clear()
})

describe('artAuditFindings', () => {
  it('reports nothing when every preloaded file is on the page', () => {
    const rendered = ['http://localhost:5173/comic-book/logo2.webp', '/comic-book/conversation.webp']
    expect(artAuditFindings(preload(), rendered, BASE)).toEqual({ unused: [], failed: [] })
  })

  it('compares absolute and relative spellings of the same file as one', () => {
    // The guard writes root-relative paths; a rendered <img> reports `currentSrc`,
    // which the browser has already resolved against the document. Comparing the two
    // as strings would report every panel as undrawn.
    const art = preload({ urls: ['/comic-book/logo2.webp'] })
    const rendered = ['http://localhost:5173/comic-book/logo2.webp']
    expect(artAuditFindings(art, rendered, BASE).unused).toEqual([])
  })

  it('compares an escaped name against its rendered form', () => {
    // `rotary phone.webp` is preloaded percent-encoded and rendered the same way, but
    // only after both have been through the URL parser.
    const art = preload({ urls: ['/comic-book/rotary%20phone.webp'] })
    const rendered = ['http://localhost:5173/comic-book/rotary%20phone.webp']
    expect(artAuditFindings(art, rendered, BASE).unused).toEqual([])
  })

  it('names the art the page never drew', () => {
    const rendered = ['http://localhost:5173/comic-book/logo2.webp']
    expect(artAuditFindings(preload(), rendered, BASE).unused).toEqual([
      '/comic-book/conversation.webp',
    ])
  })

  it('carries the fetches that failed, drawn or not', () => {
    const art = preload({ failed: ['/comic-book/conversation.webp'] })
    const rendered = art.urls
    expect(artAuditFindings(art, rendered, BASE)).toEqual({
      unused: [],
      failed: ['/comic-book/conversation.webp'],
    })
  })

  it('survives a URL the parser rejects rather than throwing mid-audit', () => {
    const art = preload({ urls: ['://not a url'] })
    expect(artAuditFindings(art, [], BASE).unused).toEqual(['://not a url'])
  })
})

describe('auditArtPreload', () => {
  function render(...srcs: string[]): void {
    document.body.innerHTML = srcs.map(src => `<img src="${src}" alt="" />`).join('')
  }

  it('does nothing when the guard did not run — another skin, no record', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    vi.useFakeTimers()
    auditArtPreload(window)
    vi.advanceTimersByTime(ART_AUDIT_DELAY_MS * 2)
    expect(warn).not.toHaveBeenCalled()
  })

  it('stays quiet when the page drew everything the guard fetched', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    vi.useFakeTimers()
    window.__carameliArt = preload()
    render('/comic-book/logo2.webp', '/comic-book/conversation.webp')

    auditArtPreload(window)
    vi.advanceTimersByTime(ART_AUDIT_DELAY_MS)
    expect(warn).not.toHaveBeenCalled()
  })

  it('logs the undrawn art, with where to reconcile the list', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    vi.useFakeTimers()
    window.__carameliArt = preload()
    render('/comic-book/logo2.webp')

    auditArtPreload(window)
    vi.advanceTimersByTime(ART_AUDIT_DELAY_MS)

    expect(warn).toHaveBeenCalledTimes(1)
    const [message, context] = warn.mock.calls[0]
    expect(message).toBe('Preloaded panel art was never drawn')
    expect(context).toMatchObject({
      page: 'home',
      preloaded: 2,
      unused: ['/comic-book/conversation.webp'],
    })
    expect(String(context?.hint)).toContain('layoutConfig.ts')
  })

  it('logs a failed fetch separately from an undrawn one', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    vi.useFakeTimers()
    window.__carameliArt = preload({ failed: ['/comic-book/conversation.webp'] })
    render('/comic-book/logo2.webp', '/comic-book/conversation.webp')

    auditArtPreload(window)
    vi.advanceTimersByTime(ART_AUDIT_DELAY_MS)

    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toBe('Preloaded panel art failed to load')
    expect(warn.mock.calls[0][1]).toMatchObject({ failed: ['/comic-book/conversation.webp'] })
  })

  it('says nothing once the visitor has switched skin', () => {
    // The art was fetched for comic-book. Another skin not drawing it is the guard
    // working, and reporting it would train everyone to ignore the entry that matters.
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    vi.useFakeTimers()
    window.__carameliArt = preload()
    localStorage.setItem('skin', 'barebone')

    auditArtPreload(window)
    vi.advanceTimersByTime(ART_AUDIT_DELAY_MS)
    expect(warn).not.toHaveBeenCalled()
  })

  it('waits for the load event before starting its clock', () => {
    // happy-dom reports a document that is still loading, which is the state main.tsx
    // runs in: the audit has to survive being installed before the page is complete.
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    vi.useFakeTimers()
    vi.spyOn(document, 'readyState', 'get').mockReturnValue('loading')
    window.__carameliArt = preload()
    render('/comic-book/logo2.webp')

    auditArtPreload(window)
    vi.advanceTimersByTime(ART_AUDIT_DELAY_MS * 2)
    expect(warn, 'the clock started before the page had loaded').not.toHaveBeenCalled()

    window.dispatchEvent(new Event('load'))
    vi.advanceTimersByTime(ART_AUDIT_DELAY_MS)
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
