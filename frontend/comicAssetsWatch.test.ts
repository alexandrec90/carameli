import { describe, expect, it, vi } from 'vitest'

import { isWatched, reconcileAssets, SYNC_DEBOUNCE_MS } from './comicAssetsWatch'
import type { AssetSyncIo } from './comicAssetsWatch'

/**
 * The wiring, with the filesystem injected. What matters here is the order of the two
 * halves — a master encoded in this pass must be registered in the same pass, or the
 * picture is on disk and not in the dropdown until something else changes — and that a
 * half-written file cannot take the dev server down with it.
 */

const MANIFEST = `export const PANEL_ASSETS: PanelAsset[] = [
  { src: '/comic-book/logo.webp', label: 'Carameli logo' },
]
`

interface FakeOptions extends Partial<AssetSyncIo> {
  exports?: string[]
  masters?: string[]
  /** Masters whose encode throws, standing in for a file still being written. */
  unreadable?: string[]
}

function fakeIo(overrides: FakeOptions = {}) {
  const exportsDir = new Set(overrides.exports ?? ['logo.webp'])
  const unreadable = new Set(overrides.unreadable ?? [])
  const written: string[] = []
  const io: AssetSyncIo = {
    listExports: () => [...exportsDir],
    listMasters: () => overrides.masters ?? [],
    readManifest: () => (written.at(-1) ?? MANIFEST),
    writeManifest: text => void written.push(text),
    // Writes the export the way the real encoder does, so a later `listExports`
    // sees it — the pass registers what it finds on disk, not what it was told.
    encode: vi.fn(async (master: string, exportName: string) => {
      if (unreadable.has(master)) throw new Error('Input buffer contains unsupported image format')
      exportsDir.add(exportName)
    }),
    log: vi.fn(),
    warn: vi.fn(),
    ...overrides,
  }
  return { io, written, exportsDir }
}

describe('reconcileAssets', () => {
  it('encodes a master that has no export', async () => {
    const { io, exportsDir } = fakeIo({ masters: ['logo.png', 'mechanic.png'] })

    const result = await reconcileAssets(io)

    expect(io.encode).toHaveBeenCalledTimes(1)
    expect(io.encode).toHaveBeenCalledWith('mechanic.png', 'mechanic.webp')
    expect(result.encoded).toEqual(['mechanic.webp'])
    expect(exportsDir.has('mechanic.webp')).toBe(true)
  })

  it('registers what it just encoded, in the same pass', async () => {
    // The order is the whole point: registering against a listing taken before the
    // encode would leave the picture on disk and out of the dropdown until the next
    // unrelated change, which is exactly the gap this plugin exists to close.
    const { io, written } = fakeIo({ masters: ['mechanic.png'] })

    const result = await reconcileAssets(io)

    expect(result.added).toEqual(['/comic-book/mechanic.webp'])
    expect(written.at(-1)).toContain("{ src: '/comic-book/mechanic.webp', label: 'Mechanic' },")
  })

  it('never re-encodes an export that already exists', async () => {
    const { io } = fakeIo({ masters: ['logo.png'], exports: ['logo.webp'] })

    await reconcileAssets(io)

    expect(io.encode).not.toHaveBeenCalled()
  })

  it('reports a failed encode and carries on, because the usual cause is a half-copied file', async () => {
    const { io, written } = fakeIo({
      masters: ['broken.png', 'mechanic.png'],
      unreadable: ['broken.png'],
    })

    const result = await reconcileAssets(io)

    // Carries on: the master after the failure is still encoded and still registered.
    // Throwing here would turn a drag-and-drop that outran its own last byte into a dev
    // server that needs restarting.
    expect(result.encoded).toEqual(['mechanic.webp'])
    expect(io.warn).toHaveBeenCalledWith(expect.stringContaining('broken.png'))
    expect(io.warn).toHaveBeenCalledWith(expect.stringContaining('retry'))
    expect(written.at(-1)).toContain('/comic-book/mechanic.webp')
    // And nothing is registered for the file that failed, so the next pass retries it
    // rather than offering a picture the server cannot serve.
    expect(written.at(-1)).not.toContain('broken')
  })

  it('writes nothing when the manifest is already level with the directory', async () => {
    const { io, written } = fakeIo({ masters: ['logo.png'] })

    const result = await reconcileAssets(io)

    expect(written).toEqual([])
    expect(result).toEqual({ encoded: [], added: [], removed: [] })
  })

  it('drops the line for an export that has been deleted', async () => {
    const { io, written } = fakeIo({ exports: ['mechanic.webp'] })

    const result = await reconcileAssets(io)

    expect(result.removed).toEqual(['/comic-book/logo.webp'])
    expect(written.at(-1)).not.toContain('logo.webp')
  })
})

describe('isWatched', () => {
  it.each([
    '/app/frontend/public/comic-book/mechanic.webp',
    'C:\\repo\\frontend\\assets-src\\comic-book\\mechanic.png',
  ])('claims %s', path => {
    expect(isWatched(path)).toBe(true)
  })

  it.each([
    '/app/frontend/public/manifest.json',
    '/app/frontend/src/skins/comic-book/Layout.tsx',
    '/app/frontend/public/comic-book',
  ])('ignores %s', path => {
    expect(isWatched(path)).toBe(false)
  })
})

describe('the debounce', () => {
  it('outlasts the encode script, so a run of it always wins the label', () => {
    // encode-comic-art.py writes the .webp and only then the manifest line carrying its
    // --label. Reconciling inside that window would append a derived label first and
    // leave the script's own call a no-op on an already-registered src.
    expect(SYNC_DEBOUNCE_MS).toBeGreaterThanOrEqual(500)
  })
})
