/**
 * Enforcement for {@link ./assetPolicy.ts} — the served tree, checked against itself.
 *
 * Two halves, and the split matters. The first half tests the header parsing and the
 * reference extraction as ordinary pure functions, against buffers and strings built
 * here. The second half points those functions at the real `public/` directory and
 * asserts the policy. If the second half fails, the first half is what tells you the
 * finding is about the assets rather than about a regex.
 *
 * **These are invariants, not benchmarks.** No assertion here times anything. A load
 * time measured in CI measures the runner — it is noisy on a shared box, it fails on a
 * bad afternoon, and a test that fails for reasons nobody controls gets muted within a
 * month. Payload size is the half of performance that is deterministic, reviewable, and
 * caused entirely by decisions in this repo, so it is the half a test can own. Measuring
 * the other half is a browser's job: `npm run build && npx lighthouse` against a preview,
 * or the `chrome-devtools` MCP performance trace, both run against something real.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { PANEL_ASSETS } from './src/skins/comic-book/editor/assets'
import { PANEL_IMG_TRANSFORMS } from './src/skins/comic-book/editor/layoutConfig'
import { PANELS } from './src/skins/comic-book/editor/layoutConfig'
import { DEFAULT_SKIN, SKIN_NAMES } from './src/skins/registry'
import {
  ASSETS_SRC_DIR,
  CONTENT_IMAGE_DIRS,
  FRONTEND_ROOT,
  MAX_CONTENT_IMAGE_BYTES,
  MAX_CONTENT_IMAGE_EDGE,
  MAX_PAGE_BYTES,
  MAX_PRELOAD_BYTES,
  NON_LOADING_SOURCES,
  PUBLIC_DIR,
  findGuardedPanelPages,
  findGuardedPanels,
  findGuardedSkins,
  findPreloadedImages,
  findRepoPathReferences,
  findServedReferences,
  frontendRelPath,
  isContentImage,
  isLoadingSource,
  listReferenceSources,
  listServedImages,
  measurePageLoads,
  rasterExemptionFor,
  safeDecode,
  readImageSize,
  readImageSizeAt,
  walkFiles,
} from './assetPolicy'

const KB = 1024

const kb = (bytes: number): string => `${(bytes / KB).toFixed(1)} KB`

/**
 * The panel art each page draws, from the layout that is its source of truth. Both the
 * guard check and the page budget need it, and they need the same answer: one measures
 * `index.html`'s copy against it, the other prices it.
 */
function drawnByPage(): Record<string, string[]> {
  const drawn: Record<string, string[]> = {}
  for (const transform of PANEL_IMG_TRANSFORMS) {
    const page = PANELS[transform.panel].page
    const url = safeDecode(transform.src)
    const urls = (drawn[page] ??= [])
    if (!urls.includes(url)) urls.push(url)
  }
  return drawn
}

/** Synthetic headers, so the parser is tested against known dimensions. */
function pngHeader(width: number, height: number): Buffer {
  const buf = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0)
  buf.write('IHDR', 12, 'latin1')
  buf.writeUInt32BE(width, 16)
  buf.writeUInt32BE(height, 20)
  return buf
}

function webpHeader(chunk: 'VP8X' | 'VP8L' | 'VP8 ', width: number, height: number): Buffer {
  const buf = Buffer.alloc(32)
  buf.write('RIFF', 0, 'latin1')
  buf.write('WEBP', 8, 'latin1')
  buf.write(chunk, 12, 'latin1')
  if (chunk === 'VP8X') {
    buf.writeUIntLE(width - 1, 24, 3)
    buf.writeUIntLE(height - 1, 27, 3)
  } else if (chunk === 'VP8L') {
    buf.writeUInt32LE(((height - 1) << 14) | (width - 1), 21)
  } else {
    buf.writeUInt16LE(width, 26)
    buf.writeUInt16LE(height, 28)
  }
  return buf
}

describe('readImageSize', () => {
  it('reads a PNG IHDR', () => {
    expect(readImageSize(pngHeader(2816, 1536))).toEqual({ width: 2816, height: 1536 })
  })

  it.each(['VP8X', 'VP8L', 'VP8 '] as const)('reads a %s WebP header', chunk => {
    expect(readImageSize(webpHeader(chunk, 2816, 1536))).toEqual({
      width: 2816,
      height: 1536,
    })
  })

  it('returns undefined for a format it does not parse, rather than guessing', () => {
    // An ICO holds several sizes at once; there is no single answer to return.
    expect(readImageSize(Buffer.from([0x00, 0x00, 0x01, 0x00, 0x03, 0x00]))).toBeUndefined()
  })

  it('returns undefined for a truncated header instead of reading past the end', () => {
    expect(readImageSize(pngHeader(64, 64).subarray(0, 12))).toBeUndefined()
  })

  it('agrees with the real files it is pointed at', () => {
    // Guards the synthetic fixtures above: a parser can be self-consistently wrong.
    const logo = readImageSizeAt(path.join(PUBLIC_DIR, 'comic-book', 'logo.webp'))
    expect(logo?.width).toBeGreaterThan(0)
    expect(logo?.height).toBeGreaterThan(0)
  })
})

describe('comic-book cursors', () => {
  const stylesheet = readFileSync(
    path.join(FRONTEND_ROOT, 'src', 'skins', 'comic-book', 'comic-book.css'),
    'utf-8',
  )

  /** Export in `public/comic-book/` ← master in `assets-src/comic-book/`. */
  const CURSORS = {
    pointer: { export: 'pointer-cursor.webp', master: 'pointer.png' },
    click: { export: 'click-cursor.webp', master: 'click.png' },
  } as const

  const sizeOfExport = (which: keyof typeof CURSORS) =>
    readImageSizeAt(path.join(PUBLIC_DIR, 'comic-book', CURSORS[which].export))
  const sizeOfMaster = (which: keyof typeof CURSORS) =>
    readImageSizeAt(path.join(ASSETS_SRC_DIR, 'comic-book', CURSORS[which].master))

  /* A system arrow draws ~19px of ink, so 32 is "the same size, a shade bigger" with
     room for the ink outline. The 128 the CSS spec allows is not the useful ceiling:
     these shipped at 64 and read as stickers. */
  it.each(Object.keys(CURSORS) as (keyof typeof CURSORS)[])(
    '%s is drawn at pointer scale, not at artwork scale',
    which => {
      const size = sizeOfExport(which)
      expect(size).toBeDefined()
      expect(Math.max(size?.width ?? Infinity, size?.height ?? Infinity)).toBeLessThanOrEqual(36)
    },
  )

  /* The two are one downscale of their own masters, which is what makes the hand look
     proportionate to the arrow. Fitting each into its own N-px box instead silently
     rescales them against each other, because the masters are not the same shape --
     that is how the hand ended up the arrow's height with a wider glyph in it. */
  it("keeps the hand at the arrow's scale", () => {
    const pointer = sizeOfExport('pointer')
    const click = sizeOfExport('click')
    const pointerMaster = sizeOfMaster('pointer')
    const clickMaster = sizeOfMaster('click')
    expect(pointer && click && pointerMaster && clickMaster).toBeTruthy()

    const exportRatio = (click?.height ?? 0) / (pointer?.height ?? 1)
    const masterRatio = (clickMaster?.height ?? 0) / (pointerMaster?.height ?? 1)
    expect(exportRatio).toBeCloseTo(masterRatio, 1)
  })

  it('keeps custom cursor URLs, hotspots, and native fallbacks in the skin stylesheet', () => {
    expect(stylesheet).toContain(
      "--cb-cursor-default: url('/comic-book/pointer-cursor.webp') 2 1, default",
    )
    expect(stylesheet).toContain(
      "--cb-cursor-click: url('/comic-book/click-cursor.webp') 9 10, pointer",
    )
    expect(stylesheet).toContain('cursor: var(--cb-cursor-default)')
    expect(stylesheet).toContain('cursor: var(--cb-cursor-click)')
  })

  /* A hotspot outside the image is silently ignored by the browser and the cursor falls
     back to the native one -- so a resize that forgets to rescale them looks like the
     custom cursor simply not loading. */
  it('keeps every hotspot inside its own image', () => {
    const hotspots: Record<keyof typeof CURSORS, RegExp> = {
      pointer: /pointer-cursor\.webp'\) (\d+) (\d+),/,
      click: /click-cursor\.webp'\) (\d+) (\d+),/,
    }
    for (const which of Object.keys(hotspots) as (keyof typeof CURSORS)[]) {
      const match = stylesheet.match(hotspots[which])
      expect(match, `no hotspot declared for ${which}`).toBeTruthy()
      const size = sizeOfExport(which)
      expect(Number(match?.[1])).toBeLessThan(size?.width ?? 0)
      expect(Number(match?.[2])).toBeLessThan(size?.height ?? 0)
    }
  })
})

describe('findServedReferences', () => {
  it('finds a root-relative asset URL', () => {
    expect(findServedReferences(`src="/comic-book/logo.webp"`)).toEqual([
      '/comic-book/logo.webp',
    ])
  })

  it('decodes percent-escapes, which name the same file as the space they encode', () => {
    expect(findServedReferences(`'/comic-book/rotary%20phone.webp'`)).toEqual([
      '/comic-book/rotary phone.webp',
    ])
  })

  it('survives a malformed escape instead of throwing over it', () => {
    expect(() => findServedReferences('/a/100%-wide.png')).not.toThrow()
  })

  it('does not read a URL out of the middle of a repository path', () => {
    // The README's re-encode command names a master by repo path. Matching the tail of
    // it as a URL invented `/comic-book/switchboard.png` and reported a 404 for a file
    // that is exactly where it should be.
    expect(findServedReferences('-i "assets-src/comic-book/switchboard.png"')).toEqual([])
  })

  it('deduplicates, since one asset is usually named in several places', () => {
    const source = `"/icons/icon-512.png" "/icons/icon-512.png"`
    expect(findServedReferences(source)).toHaveLength(1)
  })
})

describe('findRepoPathReferences', () => {
  it('finds a repo-relative path cited in prose, spaces and all', () => {
    const comment = 'the reference drawing is `assets-src/comic-book/jagged bubble.png`'
    expect(findRepoPathReferences(comment)).toEqual(['assets-src/comic-book/jagged bubble.png'])
  })

  it('ignores a served URL, which the other extractor owns', () => {
    expect(findRepoPathReferences('href="/comic-book/logo.webp"')).toEqual([])
  })
})

describe('findPreloadedImages', () => {
  it('collects image preloads in document order and skips other preloads', () => {
    const html = `
      <link rel="preload" as="font" href="/fonts/x.woff2" />
      <link rel="preload" as="image" href="/comic-book/logo.webp" />
      <link rel="stylesheet" href="/comic-book/ignored.webp" />
      <link rel="preload" as="image" href="/comic-book/rotary%20phone.webp" />`
    expect(findPreloadedImages(html)).toEqual([
      '/comic-book/logo.webp',
      '/comic-book/rotary phone.webp',
    ])
  })

  it('reads the preloads the skin guard builds, not only the ones written as tags', () => {
    // The regression this whole pair exists for. When the panel preloads moved into the
    // guard, a tags-only reader went from measuring eight images to measuring none —
    // and reported a 0 KB critical path as comfortably inside a 2.1 MB budget. A check
    // that silently starts measuring nothing is worse than no check, because it goes on
    // reporting green.
    const html = `<script>var PANELS = { classic: ['/comic-book/logo.webp', '/a/b%20c.webp'] };</script>`
    expect(findGuardedPanels(html)).toEqual(['/comic-book/logo.webp', '/a/b c.webp'])
    expect(findPreloadedImages(html)).toEqual(['/comic-book/logo.webp', '/a/b c.webp'])
  })

  it('keys the guard lists by page and keeps them apart', () => {
    const html = `<script>var PANELS = {
      classic: ['/comic-book/logo.webp'],
      home: ['/comic-book/logo2.webp', '/comic-book/logo.webp'],
    };</script>`
    expect(findGuardedPanelPages(html)).toEqual({
      classic: ['/comic-book/logo.webp'],
      home: ['/comic-book/logo2.webp', '/comic-book/logo.webp'],
    })
    // Flattened, an image shared by both pages counts once.
    expect(findGuardedPanels(html)).toEqual(['/comic-book/logo.webp', '/comic-book/logo2.webp'])
  })

  it('counts an image once when both spellings name it', () => {
    const html = `
      <link rel="preload" as="image" href="/comic-book/logo.webp" />
      <script>var PANELS = { classic: ['/comic-book/logo.webp'] };</script>`
    expect(findPreloadedImages(html)).toEqual(['/comic-book/logo.webp'])
  })

  it('returns nothing for a page with no guard, rather than throwing', () => {
    expect(findGuardedPanelPages('<html></html>')).toEqual({})
    expect(findGuardedPanels('<html></html>')).toEqual([])
    expect(findGuardedSkins('<html></html>')).toEqual({ skins: [], fallback: undefined })
  })
})

describe('isLoadingSource', () => {
  it.each(Object.keys(NON_LOADING_SOURCES))('excuses %s, which names without loading', file => {
    expect(isLoadingSource(file)).toBe(false)
  })

  it.each([
    'CLAUDE.md',
    '../.claude/rules/skin-comic-book.md',
    'src/tests/skins/assetUsage.test.ts',
    'src/skins/comic-book/PanelBubble.test.tsx',
    'src/skins/comic-book/phoneActions.spec.ts',
  ])('excuses %s, where a URL is asserted about rather than rendered', file => {
    expect(isLoadingSource(file)).toBe(false)
  })

  it.each([
    'index.html',
    'src/skins/comic-book/phoneActions.ts',
    'src/skins/comic-book/comic-book.css',
    'src/skins/comic-book/editor/layoutConfig.ts',
  ])('counts %s, which a browser acts on', file => {
    expect(isLoadingSource(file)).toBe(true)
  })

  it('does not mistake a directory named like a test for a test file', () => {
    // `src/tests/` holds the suite, but the check is on the file: a source that happens
    // to live under a directory with `test` in the name still loads what it names.
    expect(isLoadingSource('src/tests/fixtures/artwork.ts')).toBe(true)
  })
})

describe('measurePageLoads', () => {
  const served = [
    { relPath: 'a.webp', url: '/a.webp', absPath: '/a.webp', bytes: 100 },
    { relPath: 'b.webp', url: '/b.webp', absPath: '/b.webp', bytes: 200 },
    { relPath: 'chrome.webp', url: '/chrome.webp', absPath: '/chrome.webp', bytes: 10 },
    { relPath: 'cold.webp', url: '/cold.webp', absPath: '/cold.webp', bytes: 999 },
  ]
  const references = {
    'index.html': ['/chrome.webp', '/a.webp'],
    'src/skins/comic-book/editor/assets.ts': ['/cold.webp'],
  }

  it('charges a page its own art plus the chrome every page fetches', () => {
    const loads = measurePageLoads({
      served,
      art: { home: ['/a.webp'], classic: ['/b.webp'] },
      references,
    })
    expect(loads.bytes).toEqual({ home: 110, classic: 210 })
    expect(loads.shared).toEqual(['/chrome.webp'])
  })

  it("leaves a picture no page draws out of every page's total", () => {
    // The whole point of the split. `cold.webp` is the editor's dropdown offering a
    // picture no layout has placed: real bytes in `dist/`, and nobody's download.
    const loads = measurePageLoads({
      served,
      art: { home: ['/a.webp'], classic: ['/b.webp'] },
      references,
    })
    expect(loads.cold).toEqual(['/cold.webp'])
    expect(loads.bytes.home).toBe(110)
  })

  it('charges an asset with no stated reason rather than excusing it', () => {
    // A picture wired up somewhere this policy has never seen counts against every
    // page. Failing the other way would let a new loader ship unmeasured art.
    const loads = measurePageLoads({
      served,
      art: { home: ['/a.webp'], classic: ['/b.webp'] },
      references: { ...references, 'src/skins/comic-book/Hero.tsx': ['/cold.webp'] },
    })
    expect(loads.shared).toEqual(['/chrome.webp', '/cold.webp'])
    expect(loads.cold).toEqual([])
    expect(loads.bytes.home).toBe(1109)
  })

  it('counts a picture once when a page draws it twice', () => {
    const loads = measurePageLoads({
      served,
      art: { home: ['/a.webp', '/a.webp'] },
      references,
    })
    expect(loads.bytes.home).toBe(110)
  })
})

describe('the skin guard in index.html', () => {
  // Three constants are duplicated into an inline script in `index.html`: the skin list,
  // the default, and the panel URLs. The duplication is deliberate — the guard has to run
  // before any module is fetched, so it cannot import them — but a copy nothing checks is
  // a copy that drifts. Each of these asserts one half of the agreement its comment
  // promises, so editing `registry.ts` or `layoutConfig.ts` alone fails here rather than
  // in a browser, on one skin, as a missing preload nobody notices.
  const html = readFileSync(path.join(FRONTEND_ROOT, 'index.html'), 'utf-8')

  it('resolves a stored skin the same way the app does', () => {
    const { skins, fallback } = findGuardedSkins(html)

    expect(
      skins,
      'The guard SKINS list has drifted from SKIN_NAMES in src/skins/registry.ts. A skin ' +
        'missing here is treated as unrecognised and falls back to the default, so the ' +
        'guard would preload comic-book art for a visitor the app puts on another skin.',
    ).toEqual([...SKIN_NAMES])

    expect(
      fallback,
      'The guard DEFAULT has drifted from DEFAULT_SKIN in src/skins/registry.ts. A first ' +
        'visit renders one skin and preloads for another: the art arrives for a page that ' +
        'never draws it, and the page that does draw it waits.',
    ).toBe(DEFAULT_SKIN)
  })

  it('preloads, per page, exactly the panels that page draws, in the order it draws them', () => {
    expect(
      findGuardedPanelPages(html),
      'The guard PANELS record has drifted from PANEL_IMG_TRANSFORMS in ' +
        'src/skins/comic-book/editor/layoutConfig.ts. A panel dropped from the guard is ' +
        'fetched late, after the chunk that draws it, which is the load this preload list ' +
        'exists to avoid; a panel left in it after the layout stopped drawing it is bytes ' +
        "nobody sees; one on the wrong page's list loads for a page that never draws it. " +
        'Order is the preload priority, so it has to match too.',
    ).toEqual(drawnByPage())
  })

  it('fetches the art with an Image rather than a link preload', () => {
    // A `<link rel="preload" as="image">` has to be claimed by a consumer within about
    // three seconds of the load event or Chrome warns, once per file, on every load.
    // The consumer is the <img> the comic-book chunk renders, and in dev that chunk is
    // still arriving when the load event fires — so the console filled with warnings
    // about art the page went on to draw a second later. An Image is its own consumer.
    expect(
      /rel\s*=\s*["']preload["']|\.rel\s*=\s*['"]preload['"]/.test(html),
      'index.html preloads with a <link rel="preload"> again. That is the spelling ' +
        'that made Chrome warn "was preloaded using link preload but not used within ' +
        'a few seconds from the window\'s load event" for every panel on every load.',
    ).toBe(false)

    expect(
      /new Image\(\)/.test(html),
      'The guard no longer fetches the panel art at all. Nothing then starts the ' +
        'download until the comic-book chunk renders, which is the late load the ' +
        'PANELS list exists to avoid.',
    ).toBe(true)
  })
})

describe("the editor's picture manifest", () => {
  // `PANEL_ASSETS` is a hand-written list standing in for a directory listing the browser
  // cannot make. Nothing in the app renders an entry until an author picks it, so a typo
  // or a file that never got encoded surfaces as a picture that silently fails to load,
  // in dev, only for whoever opens the dropdown. The reference checks below catch the
  // opposite direction — an export nothing names — but they say nothing about an entry
  // naming nothing.

  it('offers only pictures that exist in the served tree', () => {
    const missing = PANEL_ASSETS.filter(
      asset => !existsSync(path.join(PUBLIC_DIR, safeDecode(asset.src).replace(/^\//, ''))),
    ).map(asset => `${asset.label}: ${asset.src}`)

    expect(
      missing,
      'These PANEL_ASSETS entries name a file that is not under public/. Encode the ' +
        'master from assets-src/comic-book/ before adding the line, or fix the URL — a ' +
        'picked entry that 404s leaves the panel blank with nothing said anywhere.',
    ).toEqual([])
  })

  it('offers content-directory .webp only, like every other served picture', () => {
    const offenders = PANEL_ASSETS.filter(asset => {
      const rel = safeDecode(asset.src).replace(/^\//, '')
      return !isContentImage(rel) || path.extname(rel).toLowerCase() !== '.webp'
    }).map(asset => asset.src)

    expect(
      offenders,
      `The dropdown may only offer .webp under ${CONTENT_IMAGE_DIRS.join(', ')}. A master ` +
        'or an off-format export reachable from the editor is a master one save away from ' +
        'being drawn by the layout, which is how PNG got into public/ the last time.',
    ).toEqual([])
  })

  it('names each picture once, under one label', () => {
    const srcs = PANEL_ASSETS.map(asset => safeDecode(asset.src))
    const labels = PANEL_ASSETS.map(asset => asset.label)

    expect([...new Set(srcs)], 'Two entries name the same picture.').toHaveLength(srcs.length)
    expect(
      [...new Set(labels)],
      'Two pictures share a label, so the dropdown offers the same word twice and the ' +
        'author cannot tell which one they picked.',
    ).toHaveLength(labels.length)
  })
})

describe('the served tree', () => {
  const served = listServedImages()

  it('is not empty, so a broken walk cannot pass every check below by default', () => {
    expect(served.length).toBeGreaterThan(5)
  })

  it('serves content images as .webp only', () => {
    const offenders = served
      .filter(asset => isContentImage(asset.relPath))
      .filter(asset => path.extname(asset.relPath).toLowerCase() !== '.webp')
      .map(asset => `${asset.relPath} (${kb(asset.bytes)})`)

    expect(
      offenders,
      `Non-WebP files in ${CONTENT_IMAGE_DIRS.join(', ')}. Vite copies public/ into ` +
        'dist/ verbatim, so each of these ships to every visitor at full size. If it is ' +
        'a master or a traced reference, it belongs in assets-src/; if it is meant to be ' +
        'displayed, export it to .webp. Only a platform contract earns an entry in ' +
        'RASTER_EXEMPTIONS, and the entry has to say what the contract is.',
    ).toEqual([])
  })

  it('serves no raster outside the content dirs without a stated reason', () => {
    const unexplained = served
      .filter(asset => !isContentImage(asset.relPath))
      .filter(asset => !['.webp', '.svg'].includes(path.extname(asset.relPath).toLowerCase()))
      .filter(asset => !rasterExemptionFor(asset.relPath))
      .map(asset => asset.relPath)

    expect(
      unexplained,
      'These are PNG/JPEG outside a content directory and outside RASTER_EXEMPTIONS. ' +
        'Either convert them, or add an exemption naming the contract that forbids it.',
    ).toEqual([])
  })

  it('keeps every content image under the per-image ceiling', () => {
    const oversized = served
      .filter(asset => isContentImage(asset.relPath))
      .filter(asset => asset.bytes > MAX_CONTENT_IMAGE_BYTES)
      .map(asset => `${asset.relPath}: ${kb(asset.bytes)}`)

    expect(
      oversized,
      `Over the ${kb(MAX_CONTENT_IMAGE_BYTES)} per-image ceiling. Re-export at lower ` +
        'quality or smaller dimensions rather than raising the ceiling — this number is ' +
        'a ratchet, and the panels are already several times their display width.',
    ).toEqual([])
  })

  it('keeps every content image within the dimension ratchet', () => {
    const tooLarge: string[] = []
    for (const asset of served.filter(a => isContentImage(a.relPath))) {
      const size = readImageSizeAt(asset.absPath)
      if (!size) continue
      const edge = Math.max(size.width, size.height)
      if (edge > MAX_CONTENT_IMAGE_EDGE) {
        tooLarge.push(`${asset.relPath}: ${size.width}x${size.height}`)
      }
    }

    expect(
      tooLarge,
      `Longer than ${MAX_CONTENT_IMAGE_EDGE}px on the long edge. The panels already ` +
        'carry 3-4x their display width; nothing here should get bigger.',
    ).toEqual([])
  })

  it('keeps each page\'s preloaded critical path within budget', () => {
    const html = readFileSync(path.join(FRONTEND_ROOT, 'index.html'), 'utf-8')
    const preloaded = findPreloadedImages(html)
    const pages = findGuardedPanelPages(html)
    const byUrl = new Map(served.map(asset => [asset.url, asset]))

    expect(
      preloaded.length,
      'index.html preloads no images at all. Every budget below it then passes on an ' +
        'empty set, so this is asserted rather than assumed.',
    ).toBeGreaterThan(0)

    const missing = preloaded.filter(url => !byUrl.has(url))
    expect(missing, 'index.html preloads assets that are not in public/').toEqual([])

    // A visit preloads one page's list, so each list is its own critical path and is
    // budgeted alone — summing them would budget a download no visitor makes.
    for (const [page, urls] of Object.entries(pages)) {
      const total = urls.reduce((sum, url) => sum + (byUrl.get(url)?.bytes ?? 0), 0)
      expect(
        total,
        `The ${urls.length} images preloaded for the ${page} page total ${kb(total)}, ` +
          `over the ${kb(MAX_PRELOAD_BYTES)} budget. This is the critical path: the ` +
          'comic-book layout gates its ready state on the last of them to load, so this ' +
          'number is roughly what a visitor waits for. Adding a preload without removing ' +
          'one, or growing a panel, is what puts it over.',
      ).toBeLessThanOrEqual(MAX_PRELOAD_BYTES)
    }
  })

  describe('what one visit downloads', () => {
    const references = Object.fromEntries(
      listReferenceSources().map(file => [
        frontendRelPath(file),
        findServedReferences(readFileSync(file, 'utf-8')),
      ]),
    )
    const art = drawnByPage()
    const loads = measurePageLoads({ served, art, references })

    it('measures every page the layout has, so a page cannot go unbudgeted', () => {
      expect(Object.keys(loads.bytes).sort()).toEqual(Object.keys(art).sort())
    })

    it('keeps each page within budget', () => {
      for (const [page, total] of Object.entries(loads.bytes)) {
        expect(
          total,
          `A visit to the ${page} page fetches ${kb(total)}, over the ` +
            `${kb(MAX_PAGE_BYTES)} budget: that page's panel art plus the ` +
            `${loads.shared.length} assets every route asks for. This is the number a ` +
            'visitor pays, so raising it is a decision about their connection rather ' +
            'than about this repository. Re-encoding an oversized panel is the usual fix.',
        ).toBeLessThanOrEqual(MAX_PAGE_BYTES)
      }
    })

    it('excuses a cold picture only where a source says why it is cold', () => {
      // The half of the old whole-tree cap worth keeping. Bytes no page loads are not
      // free — they sit in `dist/` — but they are not a download either, so what they
      // need is a stated reason rather than a budget line.
      const unexplained = loads.cold.filter(url => {
        const naming = Object.entries(references).filter(([, urls]) => urls.includes(url))
        return !naming.some(([source]) => source in NON_LOADING_SOURCES)
      })

      expect(
        unexplained,
        'Served, referenced, and reachable from no page — so the only reference to each ' +
          'is prose or a test. Either wire the asset up, delete it, or list the source ' +
          'that names it in NON_LOADING_SOURCES with the reason no visit fetches it.',
      ).toEqual([])
    })

    it('prices less than the whole tree, which is what this budget changed', () => {
      // Asserted rather than assumed. If the classification ever charged everything to
      // every page, each budget above would be the old whole-tree cap under a new name,
      // and would say so only by failing on the next picture somebody encoded.
      const tree = walkFiles(PUBLIC_DIR).reduce(
        (sum, rel) => sum + readFileSync(path.join(PUBLIC_DIR, rel)).byteLength,
        0,
      )

      expect(
        loads.cold.length,
        'Every served asset is charged to a page, so this budget is the whole tree ' +
          'again. Either the layout really does draw all of it, or a non-loading source ' +
          'has been dropped from NON_LOADING_SOURCES.',
      ).toBeGreaterThan(0)
      expect(Math.max(...Object.values(loads.bytes))).toBeLessThan(tree)
    })
  })
})

describe('references', () => {
  const sources = listReferenceSources()
  const text = new Map(sources.map(file => [file, readFileSync(file, 'utf-8')]))
  const rel = (file: string): string => path.relative(FRONTEND_ROOT, file).replace(/\\/g, '/')

  it('scans the files it means to, so an empty scan cannot pass as a clean one', () => {
    expect(sources.length).toBeGreaterThan(10)
    expect(sources.some(file => file.endsWith('index.html'))).toBe(true)
  })

  it('ships nothing from public/ that no source references', () => {
    const referenced = new Set<string>()
    for (const source of text.values()) {
      for (const url of findServedReferences(source)) referenced.add(url)
    }

    const orphans = listServedImages()
      .filter(asset => !referenced.has(asset.url))
      .map(asset => `${asset.relPath} (${kb(asset.bytes)})`)

    expect(
      orphans,
      'In public/ but named by nothing — shipped to every visitor and used by none. ' +
        'A traced reference or a master belongs in assets-src/; anything genuinely ' +
        'unused should be deleted. If one is loaded through a URL this scan cannot ' +
        'see, that URL is built dynamically, which no code here does today.',
    ).toEqual([])
  })

  it('names no served asset that is missing from public/', () => {
    const available = new Set(listServedImages().map(asset => asset.url))
    const broken: string[] = []
    for (const [file, source] of text) {
      for (const url of findServedReferences(source)) {
        if (!available.has(url)) broken.push(`${rel(file)} -> ${url}`)
      }
    }

    expect(broken, 'Referenced but absent from public/ — a 404 at runtime.').toEqual([])
  })

  it('cites no repository path that has moved out from under it', () => {
    // The check that would have caught this file's own change. Masters are referenced
    // only from prose, so a `git mv` breaks those citations and nothing else notices.
    const onDisk = new Set<string>([
      ...walkFiles(PUBLIC_DIR).map(rel => `public/${rel}`),
      ...walkFiles(ASSETS_SRC_DIR).map(rel => `assets-src/${rel}`),
    ])

    const stale: string[] = []
    for (const [file, source] of text) {
      for (const cited of findRepoPathReferences(source)) {
        if (!onDisk.has(cited)) stale.push(`${rel(file)} -> ${cited}`)
      }
    }

    expect(
      stale,
      'A comment or doc names an asset path that no longer exists. Nothing imports a ' +
        'master, so prose is the only reference one has and a move breaks it silently.',
    ).toEqual([])
  })
})
