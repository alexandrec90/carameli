import { describe, expect, it } from 'vitest'

import {
  deriveLabel,
  exportNameFor,
  isOfferable,
  mastersNeedingExport,
  parseManifest,
  servedUrl,
  syncManifest,
} from './comicAssets'

/**
 * Pins the reconciliation the dev server runs on every add and unlink under the
 * comic-book asset directories. The properties worth holding are the ones whose failure
 * is silent: a label an author wrote being overwritten, a duplicate line for a file whose
 * name needs percent-encoding, and — the expensive one — an unreadable directory reading
 * as "no pictures exist" and taking the whole manifest with it.
 */

const MANIFEST = `// header comment
export interface PanelAsset {
  src: string
  label: string
}

export const PANEL_ASSETS: PanelAsset[] = [
  { src: '/comic-book/logo.webp', label: 'Carameli logo' },
  { src: '/comic-book/conversation.webp', label: 'Two agents talking' },
  { src: '/comic-book/rotary%20phone.webp', label: 'Rotary phone' },
]

export function assetLabel(src: string): string {
  return PANEL_ASSETS.find(a => a.src === src)?.label ?? src
}
`

const PRESENT = ['logo.webp', 'conversation.webp', 'rotary phone.webp']

describe('deriveLabel', () => {
  it('reads as a sentence, not as a file name', () => {
    expect(deriveLabel('hand-notepad')).toBe('Hand notepad')
    expect(deriveLabel('push_button_phone')).toBe('Push button phone')
    expect(deriveLabel('rotary phone')).toBe('Rotary phone')
  })

  it('lowercases the tail, so SHOUTED file names do not shout in the dropdown', () => {
    expect(deriveLabel('MECHANIC')).toBe('Mechanic')
    expect(deriveLabel('call-BUTTON')).toBe('Call button')
  })

  it('falls back to the stem rather than throwing on one with no words in it', () => {
    expect(deriveLabel('--')).toBe('--')
  })
})

describe('servedUrl', () => {
  it('percent-encodes as urllib.parse.quote does, so both writers agree on one spelling', () => {
    // encodeURIComponent leaves `!'()*` bare; the encode script's `quote` does not. A
    // disagreement here appends a second entry for a file already in the manifest.
    expect(servedUrl('rotary phone.webp')).toBe('/comic-book/rotary%20phone.webp')
    expect(servedUrl("agent's desk.webp")).toBe('/comic-book/agent%27s%20desk.webp')
    expect(servedUrl('café.webp')).toBe('/comic-book/caf%C3%A9.webp')
    expect(servedUrl('logo.webp')).toBe('/comic-book/logo.webp')
  })
})

describe('isOfferable', () => {
  it('offers .webp panel art', () => {
    expect(isOfferable('mechanic.webp')).toBe(true)
  })

  it('never offers a cursor, which is pointer chrome rather than panel art', () => {
    expect(isOfferable('pointer-cursor.webp')).toBe(false)
    expect(isOfferable('hand-dragger-cursor.webp')).toBe(false)
  })

  it('never offers a master or an off-format file', () => {
    expect(isOfferable('mechanic.png')).toBe(false)
    expect(isOfferable('README.md')).toBe(false)
  })
})

describe('parseManifest', () => {
  it('reads every entry, in file order', () => {
    expect(parseManifest(MANIFEST).map(e => e.label)).toEqual([
      'Carameli logo',
      'Two agents talking',
      'Rotary phone',
    ])
  })

  it('reads nothing out of a file with no PANEL_ASSETS array', () => {
    expect(parseManifest('export const OTHER = []\n')).toEqual([])
  })
})

describe('syncManifest', () => {
  it('leaves a manifest already level with the directory untouched', () => {
    const sync = syncManifest(MANIFEST, PRESENT)
    expect(sync.changed).toBe(false)
    expect(sync.text).toBe(MANIFEST)
  })

  it('appends a new export with a label derived from its file name', () => {
    const sync = syncManifest(MANIFEST, [...PRESENT, 'hand-notepad.webp'])
    expect(sync.added).toEqual(['/comic-book/hand-notepad.webp'])
    expect(sync.text).toContain("{ src: '/comic-book/hand-notepad.webp', label: 'Hand notepad' },")
  })

  it('keeps the hand-written label on a picture already registered', () => {
    // The whole reason this appends rather than regenerates: 'Two agents talking' is
    // better than anything derivable from `conversation`, and an author wrote it.
    const sync = syncManifest(MANIFEST, [...PRESENT, 'mechanic.webp'])
    expect(sync.text).toContain("label: 'Two agents talking'")
  })

  it('drops an entry whose file has gone, which would otherwise 404 from the dropdown', () => {
    const sync = syncManifest(MANIFEST, ['logo.webp', 'rotary phone.webp'])
    expect(sync.removed).toEqual(['/comic-book/conversation.webp'])
    expect(sync.text).not.toContain('conversation.webp')
    expect(sync.text).toContain('rotary%20phone.webp')
  })

  it('never offers a cursor export', () => {
    const sync = syncManifest(MANIFEST, [...PRESENT, 'pointer-cursor.webp'])
    expect(sync.changed).toBe(false)
  })

  it('disambiguates a derived label that collides with one already in use', () => {
    // Two entries sharing a label fail assetPolicy.test.ts, so a drop-in file whose name
    // happens to derive an existing label must not turn adding art into a red suite.
    const sync = syncManifest(MANIFEST, [...PRESENT, 'rotary-phone.webp'])
    expect(sync.text).toContain("label: 'Rotary phone (rotary-phone)'")
    expect(sync.text).toContain("label: 'Rotary phone'")
  })

  it('refuses an empty listing rather than deleting every line in the manifest', () => {
    // A failed read, a race with a rename, or the wrong tree all come back empty, and the
    // obedient reading of empty is "no pictures exist". There is no legitimate empty
    // state: logo.webp has been in that directory since the skin existed.
    expect(syncManifest(MANIFEST, []).changed).toBe(false)
    expect(syncManifest(MANIFEST, ['pointer-cursor.webp']).changed).toBe(false)
  })

  it('refuses a source it could not parse, rather than writing an array over the file', () => {
    const sync = syncManifest('export const PANEL_ASSETS = "moved"\n', PRESENT)
    expect(sync.changed).toBe(false)
  })

  it('writes an array the file still parses, so a second pass is a no-op', () => {
    const once = syncManifest(MANIFEST, [...PRESENT, 'hand-notepad.webp'])
    expect(syncManifest(once.text, [...PRESENT, 'hand-notepad.webp']).changed).toBe(false)
  })

  it('keeps everything around the array, including the trailing helper', () => {
    const sync = syncManifest(MANIFEST, [...PRESENT, 'hand-notepad.webp'])
    expect(sync.text).toContain('// header comment')
    expect(sync.text).toContain('export function assetLabel(src: string): string {')
    expect(sync.text.endsWith('}\n')).toBe(true)
  })
})

describe('mastersNeedingExport', () => {
  it('names only masters with no export yet', () => {
    expect(
      mastersNeedingExport(['logo.png', 'mechanic.png', 'README.md'], ['logo.webp']),
    ).toEqual(['mechanic.png'])
  })

  it('maps a master to the export the encode script would write', () => {
    expect(exportNameFor('hand-notepad.png')).toBe('hand-notepad.webp')
    expect(exportNameFor('photo.JPEG')).toBe('photo.webp')
  })
})
