/**
 * What `public/` is allowed to contain, expressed as data so a test can enforce it.
 *
 * This module lives at the frontend root rather than under `src/` for the same reason
 * {@link ./devWatchPolicy.ts} does: nothing here is imported by the app, so keeping it
 * outside `src/` keeps `node:fs` out of the browser bundle entirely.
 *
 * ## Why a policy file and not a lint rule
 *
 * The comic-book skin is served from `public/`, which Vite copies into `dist/`
 * **verbatim** — no hashing, no tree-shaking, no reference analysis. A file dropped in
 * there ships to every visitor whether or not a single line of code mentions it, and
 * nothing in the toolchain will ever say so. That is not hypothetical: 24 MB of PNG
 * masters shipped in every build for months, and the four bubble reference drawings
 * were still there after the shapes they were traced for had been reimplemented as SVG.
 *
 * So the checks here are the ones the build cannot make for itself:
 *
 * | Rule | What it stops |
 * | --- | --- |
 * | {@link CONTENT_IMAGE_DIRS} are `.webp` only | a PNG master landing next to its own export |
 * | {@link MAX_CONTENT_IMAGE_BYTES} | one oversized re-export quietly tripling a panel |
 * | {@link MAX_CONTENT_IMAGE_EDGE} | a re-export at source resolution instead of display |
 * | {@link MAX_PRELOAD_BYTES} | growth on the critical path specifically |
 * | {@link MAX_PUBLIC_BYTES} | growth anywhere else in the served tree |
 * | reference check, both directions | dead weight, and paths left stale by a move |
 *
 * ## The numbers are ratchets
 *
 * Every cap is set just above what the tree costs today. That is deliberate: the value
 * of a budget is that it fails on the way *up*, and a cap with room for another whole
 * panel in it is not a budget. Lowering one as assets improve is an ordinary change.
 * Raising one is a decision about what visitors download, and should read like one in
 * review — which is exactly what a one-line diff to this file does.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * The frontend directory — this file's own home, found by looking rather than by
 * asking.
 *
 * `import.meta.url` is the obvious spelling and does not work here: Vite rewrites it
 * during the SSR transform that runs test files, so it is not a `file:` URL by the time
 * this module evaluates. Walking up from the working directory for the pair of entries
 * that identify a frontend root is spelling-independent, and it fails loudly with the
 * directory it started from rather than resolving to somewhere plausible and wrong.
 */
function findFrontendRoot(start: string = process.cwd()): string {
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, 'index.html')) && existsSync(path.join(dir, 'public'))) {
      return dir
    }
    if (path.dirname(dir) === dir) {
      throw new Error(`No frontend root (index.html beside public/) at or above ${start}`)
    }
  }
}

export const FRONTEND_ROOT = findFrontendRoot()

/** Copied verbatim into `dist/`. Everything in here is shipped. */
export const PUBLIC_DIR = path.join(FRONTEND_ROOT, 'public')

/** Masters and traced references. Never copied into the build. */
export const ASSETS_SRC_DIR = path.join(FRONTEND_ROOT, 'assets-src')

/** Extensions treated as images by every check below. */
export const IMAGE_EXTENSIONS: readonly string[] = [
  '.webp',
  '.png',
  '.jpg',
  '.jpeg',
  '.avif',
  '.gif',
  '.svg',
  '.ico',
]

/**
 * Directories under `public/` holding page content — artwork a visitor sees rendered
 * into the layout. These are the ones held to `.webp`, because they are the ones where
 * the format is a free choice and the payload is large enough for it to matter.
 */
export const CONTENT_IMAGE_DIRS: readonly string[] = ['comic-book']

/**
 * Raster files exempt from the `.webp` rule, each with the reason it cannot be one.
 *
 * Both entries are platform contracts rather than preferences: `apple-touch-icon` is
 * read by Safari, which has never accepted WebP there, and a `.ico` is a container
 * format that a WebP cannot be renamed into. The manifest icons are PNG for the same
 * reason — installability is decided by a browser's icon parser, not by ours.
 *
 * A key is matched as a path prefix relative to `public/`, so `icons/` covers the
 * directory. Adding an entry means writing down why the file cannot be WebP; if the
 * honest answer is "nobody has converted it yet", convert it instead.
 */
export const RASTER_EXEMPTIONS: Readonly<Record<string, string>> = {
  'icons/': 'PWA and apple-touch icons; browser icon parsers require PNG',
  'favicon.ico': 'ICO is a multi-resolution container, not a renamed image',
}

/** Ceiling for one content image. Today's largest is `switchboard.webp` at 583 KB. */
export const MAX_CONTENT_IMAGE_BYTES = 640 * 1024

/**
 * Longest edge allowed on a content image.
 *
 * Set at exactly the current maximum, which is the point: the panels are 2816px wide
 * against a display width of roughly 700–900px, so they carry 3–4x the pixels they can
 * show. That is a visual-quality call somebody made deliberately and this file does not
 * overturn it — it only stops the number growing. Lowering it is the largest remaining
 * payload win available, and is a change to make on purpose with a look at the result.
 */
export const MAX_CONTENT_IMAGE_EDGE = 2816

/**
 * Everything `index.html` preloads, summed. This is the critical path: the browser
 * fetches all of it before the comic-book layout can settle, because the skin gates
 * `ready` on the last image to load rather than the first.
 */
export const MAX_PRELOAD_BYTES = 2_100 * 1024

/** The whole served tree, images and all. */
export const MAX_PUBLIC_BYTES = 2_850 * 1024

/**
 * Source trees scanned for references to served assets, relative to the frontend.
 *
 * `.claude/rules` is outside the frontend and is scanned anyway, because that is where
 * the skin's asset paths are written down at length — a rule file citing a master is
 * exactly as stale-able as a code comment citing one, and rather more likely to be
 * believed.
 */
export const REFERENCE_GLOB_DIRS: readonly string[] = [
  'src',
  'assets-src',
  '../.claude/rules',
]

/** Individual files scanned alongside {@link REFERENCE_GLOB_DIRS}. */
export const REFERENCE_FILES: readonly string[] = [
  'index.html',
  'public/manifest.json',
  'CLAUDE.md',
]

/** Extensions whose contents are searched for asset references. */
export const REFERENCE_EXTENSIONS: readonly string[] = [
  '.ts',
  '.tsx',
  '.css',
  '.html',
  '.json',
  '.md',
]

/** A file found under `public/`, with its path expressed as the URL it is served at. */
export interface ServedAsset {
  /** Path relative to `public/`, forward-slashed: `comic-book/logo.webp`. */
  readonly relPath: string
  /** The URL a browser requests it by: `/comic-book/logo.webp`. */
  readonly url: string
  /** Absolute path on disk. */
  readonly absPath: string
  readonly bytes: number
}

/** Pixel dimensions read from an image header. */
export interface ImageSize {
  readonly width: number
  readonly height: number
}

/** True when `relPath` is excused from the `.webp` rule by {@link RASTER_EXEMPTIONS}. */
export function rasterExemptionFor(relPath: string): string | undefined {
  for (const [prefix, reason] of Object.entries(RASTER_EXEMPTIONS)) {
    if (relPath === prefix || relPath.startsWith(prefix)) return reason
  }
  return undefined
}

/** True when `relPath` sits inside one of {@link CONTENT_IMAGE_DIRS}. */
export function isContentImage(relPath: string): boolean {
  return CONTENT_IMAGE_DIRS.some(dir => relPath.startsWith(`${dir}/`))
}

/** Every file under `dir`, recursively, as paths relative to `dir` with `/` separators. */
export function walkFiles(dir: string): string[] {
  const out: string[] = []
  const visit = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) visit(path.join(current, entry.name), rel)
      else out.push(rel)
    }
  }
  visit(dir, '')
  return out.sort()
}

/** Every image served from `public/`. */
export function listServedImages(publicDir: string = PUBLIC_DIR): ServedAsset[] {
  return walkFiles(publicDir)
    .filter(rel => IMAGE_EXTENSIONS.includes(path.extname(rel).toLowerCase()))
    .map(rel => {
      const absPath = path.join(publicDir, rel)
      return { relPath: rel, url: `/${rel}`, absPath, bytes: statSync(absPath).size }
    })
}

/**
 * Pixel dimensions from a PNG or WebP header, or `undefined` for anything else.
 *
 * Deliberately hand-rolled rather than pulled from a dependency: the whole of it is
 * twenty lines of header arithmetic, and a policy test that fails because an image
 * library moved is a test nobody trusts. `.ico` and `.svg` return `undefined` — an ICO
 * holds several sizes at once and an SVG has no intrinsic pixel size, so neither has a
 * single number the dimension cap could mean anything about.
 */
export function readImageSize(buffer: Buffer): ImageSize | undefined {
  // PNG: an 8-byte signature, then an IHDR chunk whose first two fields are the size.
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }

  // WebP: a RIFF container whose first chunk names one of three encodings, each of
  // which stores its size differently.
  if (
    buffer.length >= 30 &&
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    const chunk = buffer.subarray(12, 16).toString('latin1')

    // Extended: 24-bit width-1 and height-1, little-endian, after the feature flags.
    if (chunk === 'VP8X') {
      return {
        width: buffer.readUIntLE(24, 3) + 1,
        height: buffer.readUIntLE(27, 3) + 1,
      }
    }

    // Lossless: 14 bits each, packed into the 32 bits after the signature byte.
    if (chunk === 'VP8L') {
      const packed = buffer.readUInt32LE(21)
      return {
        width: (packed & 0x3fff) + 1,
        height: ((packed >> 14) & 0x3fff) + 1,
      }
    }

    // Lossy: 14-bit dimensions in the VP8 keyframe header; the top two bits are scale.
    if (chunk === 'VP8 ') {
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff,
      }
    }
  }

  return undefined
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** {@link readImageSize} against a path. */
export function readImageSizeAt(absPath: string): ImageSize | undefined {
  return readImageSize(readFileSync(absPath).subarray(0, 64))
}

const EXTENSION_ALTERNATION = IMAGE_EXTENSIONS.map(ext => ext.slice(1)).join('|')

/**
 * `decodeURIComponent`, but a lone `%` yields the original text instead of throwing.
 *
 * A malformed escape is not this file's problem to report — failing the whole asset
 * suite with a `URIError` would say nothing about the tree and hide whatever the real
 * finding was. Comparing the undecoded spelling is the correct fallback: if it does not
 * match a file on disk, the reference check reports it as the broken reference it is.
 */
export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/**
 * Root-relative URLs of served assets referenced by `source` — what the app fetches.
 *
 * Percent-escapes are decoded, because `rotary%20phone.webp` and `rotary phone.webp`
 * name the same file on disk and only one of the two spellings can be compared against
 * a directory listing.
 */
export function findServedReferences(source: string): string[] {
  // The leading `/` must begin the path rather than sit in the middle of one. Without
  // the lookbehind, `assets-src/comic-book/switchboard.png` yields a phantom URL
  // `/comic-book/switchboard.png`, and the broken-reference check then reports a 404
  // against a master that is exactly where it belongs.
  const pattern = new RegExp(
    `(?<![\\w%@.-])/[\\w%@./-]*\\.(?:${EXTENSION_ALTERNATION})\\b`,
    'gi',
  )
  const found = new Set<string>()
  for (const match of source.matchAll(pattern)) found.add(safeDecode(match[0]))
  return [...found].sort()
}

/**
 * Repository-relative asset paths named in `source` — the ones that appear in prose.
 *
 * Comments and rule files cite assets by their place in the repo (`public/comic-book/…`,
 * `assets-src/comic-book/…`) rather than by URL, and those citations go stale silently
 * when a file moves. They are the only reference to a master that exists at all, since
 * nothing imports one, so checking them is the only way a move gets caught.
 */
export function findRepoPathReferences(source: string): string[] {
  const pattern = new RegExp(
    `\\b(?:public|assets-src)/[\\w%@./ -]*?\\.(?:${EXTENSION_ALTERNATION})\\b`,
    'gi',
  )
  const found = new Set<string>()
  for (const match of source.matchAll(pattern)) found.add(safeDecode(match[0]))
  return [...found].sort()
}

/** Absolute paths of every file that may contain an asset reference. */
export function listReferenceSources(root: string = FRONTEND_ROOT): string[] {
  const files = REFERENCE_FILES.map(rel => path.join(root, rel))
  for (const dir of REFERENCE_GLOB_DIRS) {
    const abs = path.join(root, dir)
    for (const rel of walkFiles(abs)) {
      if (REFERENCE_EXTENSIONS.includes(path.extname(rel).toLowerCase())) {
        files.push(path.join(abs, rel))
      }
    }
  }
  return files.sort()
}

/**
 * Every image `html` preloads, whether by a static tag or through the skin guard.
 *
 * Both spellings have to count. The panel art is preloaded only for the skin that
 * draws it, which means the tags are built by an inline script rather than written
 * out — and a check that read only static tags would have gone from measuring eight
 * images to measuring none the moment that guard landed, reporting a critical path of
 * 0 KB as comfortably inside budget.
 */
export function findPreloadedImages(html: string): string[] {
  const out: string[] = []

  const tags = /<link\b[^>]*\brel=["']preload["'][^>]*>/gi
  for (const [tag] of html.matchAll(tags)) {
    if (!/\bas=["']image["']/i.test(tag)) continue
    const href = /\bhref=["']([^"']+)["']/i.exec(tag)
    if (href) out.push(safeDecode(href[1]))
  }

  out.push(...findGuardedPanels(html))
  return [...new Set(out)]
}

/** The `PANELS` list the skin guard preloads, or `[]` if the guard is not there. */
export function findGuardedPanels(html: string): string[] {
  const block = /\bvar\s+PANELS\s*=\s*\[([\s\S]*?)\]/.exec(html)
  if (!block) return []
  return [...block[1].matchAll(/['"]([^'"]+)['"]/g)].map(match => safeDecode(match[1]))
}

/** The skin list and default the inline guard resolves against. */
export function findGuardedSkins(html: string): { skins: string[]; fallback?: string } {
  const list = /\bvar\s+SKINS\s*=\s*\[([\s\S]*?)\]/.exec(html)
  const fallback = /\bvar\s+DEFAULT\s*=\s*['"]([^'"]+)['"]/.exec(html)
  return {
    skins: list ? [...list[1].matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]) : [],
    fallback: fallback?.[1],
  }
}
