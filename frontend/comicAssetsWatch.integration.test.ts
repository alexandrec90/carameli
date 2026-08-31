import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { ASSET_DIR_IN_FRONTEND, EXPORT_MAX_EDGE, MANIFEST_IN_FRONTEND, MASTERS_DIR_IN_FRONTEND } from './comicAssets'
import { nodeAssetSyncIo, reconcileAssets } from './comicAssetsWatch'

/**
 * The half `comicAssetsWatch.test.ts` cannot reach: whether the real IO does what the
 * injected fake pretends. The three things only a disk can answer are where the paths
 * land, whether `sharp` is actually reachable through a dynamic import, and whether the
 * encode produces an image inside the budget — and every one of them fails silently
 * against a fake, showing up instead as a picture that never appears in the dropdown.
 *
 * A real `frontend/` shape in a temp directory, a real PNG made by sharp, and no network.
 */

let frontend: string
let mastersDir: string
let exportsDir: string
let manifest: string

const MANIFEST_SOURCE = `export interface PanelAsset {
  src: string
  label: string
}

export const PANEL_ASSETS: PanelAsset[] = [
  { src: '/comic-book/logo.webp', label: 'Carameli logo' },
]
`

const quiet = { log: () => {}, warn: () => {} }

beforeAll(async () => {
  frontend = mkdtempSync(join(tmpdir(), 'comic-assets-'))
  mastersDir = join(frontend, MASTERS_DIR_IN_FRONTEND)
  exportsDir = join(frontend, ASSET_DIR_IN_FRONTEND)
  manifest = join(frontend, MANIFEST_IN_FRONTEND)
  mkdirSync(mastersDir, { recursive: true })
  mkdirSync(exportsDir, { recursive: true })
  mkdirSync(join(manifest, '..'), { recursive: true })
  writeFileSync(manifest, MANIFEST_SOURCE, 'utf8')

  // Wider than EXPORT_MAX_EDGE on purpose, and portrait-ish, so the resize has
  // something to do and `fit: 'inside'` is the assertion rather than a no-op.
  const { default: sharp } = await import('sharp')
  await sharp({
    create: { width: 2816, height: 2000, channels: 3, background: { r: 210, g: 90, b: 60 } },
  })
    .png()
    .toFile(join(mastersDir, 'rotary phone.png'))

  // The export the fixture manifest already offers. It exists so the directory is never
  // empty: an empty listing is what an unreadable directory looks like, and `syncManifest`
  // refuses to empty the manifest on the strength of one.
  await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .webp()
    .toFile(join(exportsDir, 'logo.webp'))
})

afterAll(() => {
  rmSync(frontend, { recursive: true, force: true })
})

describe('reconcileAssets over a real directory', () => {
  it('encodes the master, bounds its long edge, and offers it in one pass', async () => {
    const io = nodeAssetSyncIo(frontend, quiet)

    const result = await reconcileAssets(io)

    expect(result.encoded).toEqual(['rotary phone.webp'])
    const { default: sharp } = await import('sharp')
    // From bytes, not from the path: libvips keeps a file open behind a path-based
    // pipeline, and on Windows that handle makes the later delete fail with EPERM --
    // which reads as a bug in the sync rather than as this test holding the file.
    const meta = await sharp(readFileSync(join(exportsDir, 'rotary phone.webp'))).metadata()
    expect(meta.format).toBe('webp')
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(EXPORT_MAX_EDGE)

    // The space is percent-encoded, because this string ends up in an `<img src>`.
    expect(readFileSync(manifest, 'utf8')).toContain(
      "{ src: '/comic-book/rotary%20phone.webp', label: 'Rotary phone' },",
    )
  })

  it('leaves both the export and the manifest alone on a second pass', async () => {
    // Re-encoding on every restart would compound WebP loss on art nobody touched, and
    // rewriting a level manifest would reload every open editor tab for nothing.
    const before = statSync(join(exportsDir, 'rotary phone.webp')).mtimeMs
    const manifestBefore = readFileSync(manifest, 'utf8')

    const result = await reconcileAssets(nodeAssetSyncIo(frontend, quiet))

    expect(result).toEqual({ encoded: [], added: [], removed: [] })
    expect(statSync(join(exportsDir, 'rotary phone.webp')).mtimeMs).toBe(before)
    expect(readFileSync(manifest, 'utf8')).toBe(manifestBefore)
  })

  it('takes the line back out when the picture is deleted', async () => {
    // The master goes too: leaving it would have the next pass encode the export back,
    // which is the correct answer to a deleted export and the wrong one to test here.
    rmSync(join(exportsDir, 'rotary phone.webp'))
    rmSync(join(mastersDir, 'rotary phone.png'))

    const result = await reconcileAssets(nodeAssetSyncIo(frontend, quiet))

    expect(result.removed).toEqual(['/comic-book/rotary%20phone.webp'])
    expect(readFileSync(manifest, 'utf8')).not.toContain('rotary')
    // The hand-written entry that was there first is untouched.
    expect(readFileSync(manifest, 'utf8')).toContain("label: 'Carameli logo'")
  })

  it('reads and writes below frontend/ only, so the container can see every path', () => {
    // docker-compose bind-mounts `frontend/` alone. A path resolved from the repo root
    // works on the host and does not exist in the container, where this actually runs.
    for (const path of [MASTERS_DIR_IN_FRONTEND, ASSET_DIR_IN_FRONTEND, MANIFEST_IN_FRONTEND]) {
      expect(path.startsWith('..')).toBe(false)
    }
    expect(existsSync(join(frontend, MANIFEST_IN_FRONTEND))).toBe(true)
  })
})
