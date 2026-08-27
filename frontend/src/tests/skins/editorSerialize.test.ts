import { describe, expect, it } from 'vitest'

import {
  addImg,
  patchBubble,
  patchChain,
  patchImg,
  patchPattern,
  seedConfig,
} from '../../skins/comic-book/editor/configOps'
import {
  PANEL_BUBBLE_TRANSFORMS,
  PANEL_IMG_TRANSFORMS,
  PANEL_PATTERNS,
} from '../../skins/comic-book/editor/layoutConfig'
// The file the Save button overwrites, as text — the only way to assert that a save
// with nothing changed rewrites it byte for byte.
import layoutConfigSource from '../../skins/comic-book/editor/layoutConfig.ts?raw'
import { moveVertex } from '../../skins/comic-book/editor/panelGridOps'
import { serializeConfig, serializeConfigFile } from '../../skins/comic-book/editor/serialize'
import { newTable } from '../../skins/comic-book/editor/tableValidate'
import type { EditorConfig } from '../../skins/comic-book/editor/types'
import { PANELS } from '../../skins/comic-book/panels'

const IMPORT_LINE =
  "import type { ImgTransform, BubbleTransform, BubbleChain, PageGrids } from './types'"

/**
 * Count `{ ... }` object entries inside the named const's array literal. An entry with
 * a projected surface spans lines and nests `{`/`]` (a pad's quad, a table's rows), so
 * bound at the array's own close bracket in column 0 and count only entry-opening
 * lines at entry indent.
 */
function entryCount(ts: string, constName: string): number {
  const after = ts.slice(ts.indexOf(`export const ${constName}`))
  const arr = after.slice(0, after.indexOf('\n]'))
  return (arr.match(/^ {2}\{ /gm) ?? []).length
}

/**
 * Count quoted style names inside the PANEL_PATTERNS array literal. The block holds
 * bare strings, not `{ ... }` entries, so {@link entryCount} cannot count it.
 */
function patternCount(ts: string): number {
  const after = ts.slice(ts.indexOf('export const PANEL_PATTERNS'))
  const start = after.indexOf('= [') + 2 // skip past the `PanelBgStyle[]` type annotation
  const arr = after.slice(start, after.indexOf(']', start))
  return (arr.match(/'/g) ?? []).length / 2
}

/** The two transform blocks, without the chain, pattern and grid blocks that follow. */
function transformsOf(ts: string): string {
  const chains = ts.indexOf('export const PANEL_BUBBLE_CHAINS')
  return chains === -1 ? ts : ts.slice(0, chains)
}

/** Evaluate a serialized block back into a config, as a paste into the file would. */
function reparse(ts: string): EditorConfig {
  const body = ts
    .replace("import type { PanelBgStyle } from '../panelPatterns'", '')
    .replace(IMPORT_LINE, '')
    .replace(/export const PANEL_IMG_TRANSFORMS: ImgTransform\[\] =/, 'const images =')
    .replace(/export const PANEL_BUBBLE_TRANSFORMS: BubbleTransform\[\] =/, 'const bubbles =')
    .replace(/export const PANEL_BUBBLE_CHAINS: BubbleChain\[\] =/, 'const chains =')
    .replace(/export const PANEL_PATTERNS: PanelBgStyle\[\] =/, 'const patterns =')
    .replace(/export const PANEL_GRIDS: PageGrids =/, 'const grids =')
  return new Function(`${body}\nreturn { images, bubbles, chains, grids, patterns }`)() as EditorConfig
}

describe('serializeConfig', () => {
  it('emits all the const blocks — every picture, bubble and pattern', () => {
    const ts = serializeConfig(seedConfig())
    expect(ts).toContain('export const PANEL_IMG_TRANSFORMS: ImgTransform[] = [')
    expect(ts).toContain('export const PANEL_BUBBLE_TRANSFORMS: BubbleTransform[] = [')
    expect(ts).toContain('export const PANEL_PATTERNS: PanelBgStyle[] = [')
    expect(entryCount(ts, 'PANEL_IMG_TRANSFORMS')).toBe(PANEL_IMG_TRANSFORMS.length)
    expect(entryCount(ts, 'PANEL_BUBBLE_TRANSFORMS')).toBe(PANEL_BUBBLE_TRANSFORMS.length)
    expect(patternCount(ts)).toBe(PANEL_PATTERNS.length)
  })

  // Save overwrites layoutConfig.ts verbatim, so a rule that lives only in that file's
  // prose is deleted by the first save unless the serializer writes it back out.
  it('carries the explanatory headers, the same-panel link rule included', () => {
    const ts = serializeConfig(seedConfig())
    expect(ts).toContain('Not parallel to PANELS: each picture names its `panel`')
    expect(ts).toContain("the panel's own polygon scaled into it")
    expect(ts).toContain('must name a bubble on the same panel')
    expect(ts).toContain("`tail` which way the tail points ('none'")
    expect(ts).toContain('Two pairs ship linked')
    expect(ts).toContain('The one array here that IS parallel to PANELS')
    expect(ts).toContain('falls back to the shipped default on hydrate')
  })

  it('writes the pattern an author picked, under its panel label comment', () => {
    const ts = serializeConfig(patchPattern(seedConfig(), 0, 'sunburst'))
    expect(ts).toContain("  'sunburst', // Logo\n")
    // The Logo 2 slot legitimately keeps this style; only the patched slot loses it.
    expect(ts).not.toContain("  'halftone-gradient', // Logo\n")
  })

  // The patterns block iterates PANELS, not the config: the array is parallel by
  // contract, so a slot the working copy never carried serializes as its default
  // rather than as `undefined`.
  it('serializes the shipped default for a pattern slot the config never carried', () => {
    const cfg = seedConfig()
    cfg.patterns = cfg.patterns.slice(0, 3)
    const ts = serializeConfig(cfg)
    expect(patternCount(ts)).toBe(PANELS.length)
    expect(ts).not.toContain('undefined')
    expect(ts).toContain("  'halftone-gradient', // Logo 2\n")
  })

  it('reproduces the default values verbatim', () => {
    const ts = serializeConfig(seedConfig())
    expect(ts).toContain(
      "{ panel: 0, src: '/comic-book/logo.webp', alt: 'Carameli', " +
        'left: 0, top: 0, width: 100, height: 100, scale: 1, offsetX: 0, offsetY: 0, ' +
        "anchor: 'center center', spill: false },",
    )
    expect(ts).toContain(
      "{ panel: 1, src: '/comic-book/switchboard.webp', alt: 'Switchboard', " +
        'left: 0, top: 0, width: 100, height: 100, scale: 1, offsetX: 0, offsetY: 0, ' +
        "anchor: 'center bottom', spill: false },",
    )
    expect(ts).toContain(
      '{ panel: 0, top: -35, right: -12, width: 55, rotate: -5, spill: true, ' +
        "type: 'soft', tail: 'down-left', content: 'text', " +
        'text: "It\'s Carameli!", linkTo: 1, ' +
        "hoverType: 'cloud', clickType: 'lightning', chain: '' },",
    )
  })

  // The frame is the picture's own now, so it is the part a save must carry: an
  // emitter that dropped it would silently snap every picture back onto its panel.
  it('writes the frame a picture was dragged and resized to', () => {
    const ts = serializeConfig(patchImg(seedConfig(), 3, { left: -12.5, top: 20, width: 55, height: 40 }))
    expect(ts).toContain('left: -12.5, top: 20, width: 55, height: 40,')
  })

  it('writes the panel a picture belongs to, so two may share one', () => {
    const ts = serializeConfig(patchImg(seedConfig(), 0, { panel: 6 }))
    expect(ts).toContain("{ panel: 6, src: '/comic-book/logo.webp',")
  })

  it('escapes a quote the author typed into a src or an alt', () => {
    const ts = serializeConfig(patchImg(seedConfig(), 1, { alt: 'a "quoted" board', src: "/a'b.webp" }))
    expect(ts).toContain('src: "/a\'b.webp", alt: \'a "quoted" board\',')
  })

  it('writes the panel a bubble belongs to, so the association survives a save', () => {
    const ts = serializeConfig(patchBubble(seedConfig(), 0, { panel: 6 }))
    expect(ts).toContain('{ panel: 6, top: -35,')
  })

  it('writes the content kind, so a wheel bubble survives a save', () => {
    const ts = serializeConfig(
      patchBubble(seedConfig(), 0, { content: 'wheel', text: 'One, Two, Three' }),
    )
    expect(ts).toContain("content: 'wheel', text: 'One, Two, Three',")
    expect(serializeConfig(seedConfig())).toContain("content: 'text',")
  })

  it('writes the tail direction, "none" included and quoted like any other', () => {
    const ts = serializeConfig(patchBubble(seedConfig(), 0, { tail: 'up-right' }))
    expect(ts).toContain("tail: 'up-right',")
    expect(serializeConfig(seedConfig())).toContain("tail: 'none',")
  })

  it('emits an absent link or event shape as a bare null, not a quoted one', () => {
    const cfg = patchBubble(seedConfig(), 0, {
      linkTo: null,
      hoverType: null,
      clickType: null,
    })
    const ts = serializeConfig(cfg)
    expect(ts).toContain("linkTo: null, hoverType: null, clickType: null, chain: '' },")
    expect(ts).not.toContain("'null'")
  })

  it('rounds float noise out of the output', () => {
    let cfg = patchImg(seedConfig(), 1, {
      // A drag produces percentages with long tails; a wheel produces scale noise.
      left: 19.999999998,
      top: 20.04,
      width: 55.06,
      height: 55.949999,
      scale: 1.0000000002,
      offsetX: 12.4,
      offsetY: -8.7,
    })
    cfg = patchBubble(cfg, 1, { top: -35.49, right: -11.6, width: 54.8, rotate: -4.96 })
    const ts = serializeConfig(cfg)
    // Transform values only. A vertex is a *fraction* of the frame, so its own rounding
    // is four places (about a tenth of a pixel), and asserting "no three-decimal number
    // anywhere" would now be asserting that the grid is rounded to a whole percent.
    expect(transformsOf(ts)).not.toMatch(/\d\.\d{3,}/)
    expect(ts).toContain(
      'left: 20, top: 20, width: 55.1, height: 55.9, scale: 1, offsetX: 12, offsetY: -9,',
    )
    expect(ts).toContain('{ panel: 0, top: -35, right: -12, width: 55, rotate: -5, spill: true,')
  })

  it('rounds vertex noise out of the grids without flattening the shape', () => {
    const cfg = seedConfig()
    const grid = cfg.grids.classic.landscape
    // What a drag actually produces: a pointer pixel divided by the frame width.
    cfg.grids.classic.landscape = moveVertex(grid, 2, [0.2448979591836, 0.4171428571428])
    const ts = serializeConfig(cfg)
    expect(ts).toContain('[0.2449, 0.4171]')
    expect(ts.slice(ts.indexOf('export const PANEL_GRIDS'))).not.toMatch(/\d\.\d{5,}/)
  })

  it('escapes bubble text with quotes, backslashes, and newlines', () => {
    const cfg = patchBubble(seedConfig(), 0, { text: 'a "quote"\nand \\ slash' })
    expect(serializeConfig(cfg)).toContain("text: 'a \"quote\"\\nand \\\\ slash'")
  })

  // Which quote wins is decided per string, by whichever needs fewer escapes — the
  // shipped "It's Carameli!" is the one line in the config that comes out double.
  it('quotes single by default and double only to avoid escaping an apostrophe', () => {
    const ts = serializeConfig(seedConfig())
    expect(ts).toContain('text: "It\'s Carameli!"')
    expect(ts).toContain("text: '...at your service!'")
    // Nothing in the shipped config needs an escaped apostrophe, and reaching for one
    // would mean the cheaper quote was passed over.
    expect(ts).not.toContain("\\'")
  })

  it('keeps two decimals of precision on scale', () => {
    const cfg = patchImg(seedConfig(), 2, { scale: 1.234 })
    expect(serializeConfig(cfg)).toContain('scale: 1.23,')
  })

  // Frame percentages keep one decimal, not zero: a 400-wide panel resolves 0.1% to
  // sub-pixel, and rounding to integers would visibly nudge a frame on every save.
  it('keeps one decimal of precision on the frame', () => {
    const ts = serializeConfig(patchImg(seedConfig(), 2, { left: 12.34, width: 44.56 }))
    expect(ts).toContain('left: 12.3,')
    expect(ts).toContain('width: 44.6,')
  })

  it('produces a string that re-evaluates back to the same config', () => {
    const cfg = patchBubble(patchImg(seedConfig(), 0, { scale: 1.5, offsetY: -20 }), 0, {
      top: -40,
      width: 60,
    })
    const parsed = reparse(serializeConfig(cfg))
    expect(parsed.images).toHaveLength(PANEL_IMG_TRANSFORMS.length)
    expect(parsed.bubbles).toHaveLength(PANEL_BUBBLE_TRANSFORMS.length)
    expect(parsed.images[0]).toEqual({
      ...PANEL_IMG_TRANSFORMS[0],
      scale: 1.5,
      offsetY: -20,
    })
    expect(parsed.bubbles[0]).toEqual({ ...PANEL_BUBBLE_TRANSFORMS[0], top: -40, width: 60 })
  })

  it('round-trips a bubble the author added rather than dropping it', () => {
    const cfg = seedConfig()
    cfg.bubbles.push({ ...cfg.bubbles[0], panel: 7, text: 'Added', linkTo: null })
    const last = cfg.bubbles.length - 1
    const parsed = reparse(serializeConfig(cfg))
    expect(parsed.bubbles).toHaveLength(cfg.bubbles.length)
    expect(parsed.bubbles[last]).toEqual(cfg.bubbles[last])
  })

  // A second picture on a panel is the thing the whole change exists for, so a save
  // that silently dropped it back to one-per-panel would undo the feature.
  it('round-trips a second picture the author put on an occupied panel', () => {
    const { config, index } = addImg(seedConfig(), 3)
    const parsed = reparse(serializeConfig(config))
    expect(parsed.images).toHaveLength(config.images.length)
    expect(parsed.images[index]).toEqual(config.images[index])
    expect(parsed.images.filter(t => t.panel === 3)).toHaveLength(2)
  })

  // A surface is a nested block on a picture line, and the picture's own fields have to
  // come through it unchanged: an emitter that closed the brace in the wrong place
  // produces a file that still parses and has lost the anchor or the spill flag.
  it('round-trips a picture the author turned into a surface', () => {
    const cfg = patchImg(seedConfig(), 2, { table: newTable() })
    const parsed = reparse(serializeConfig(cfg))
    expect(parsed.images[2]).toEqual(cfg.images[2])
    expect(parsed.images[2].table?.data).toEqual(newTable().data)
  })

  /*
   * The other half of that, and the reason `table` is absent rather than null: a picture
   * that is not a surface must come back with no `table` key whatsoever. An emitter that
   * wrote `table: null` would round-trip through this reparse and then fail the
   * byte-for-byte test below, having already put eight dead keys into the shipped file.
   */
  it('writes a table only on the pictures that are surfaces', () => {
    const cfg = patchImg(seedConfig(), 2, { table: newTable() })
    const ts = serializeConfig(cfg)
    // The patched picture plus the shipped notepad surface (panel 10).
    expect((ts.match(/ table: \{/g) ?? [])).toHaveLength(2)
    expect((serializeConfig(seedConfig()).match(/ table: \{/g) ?? [])).toHaveLength(1)
    expect(
      reparse(serializeConfig(seedConfig())).images.filter(t => 'table' in t),
    ).toHaveLength(1)
  })

  it('round-trips an edited pattern back to the same style name', () => {
    const cfg = patchPattern(seedConfig(), 9, 'vignette')
    const parsed = reparse(serializeConfig(cfg))
    expect(parsed.patterns).toHaveLength(PANEL_PATTERNS.length)
    expect(parsed.patterns[9]).toBe('vignette')
  })
})

describe('serializeConfig chains', () => {
  /** The seed config with one two-column conversation on panel 6, and settings on it. */
  function threaded(): EditorConfig {
    let cfg = seedConfig()
    cfg = patchBubble(cfg, 0, { chain: 'her side' })
    cfg = patchBubble(cfg, 1, { chain: 'her side' })
    return patchChain(cfg, 'her side', {
      grow: true, stepMs: 450, rows: 4, messages: ['Hi', '> You up?'],
    })
  }

  it('writes the chain’s id on every bubble that carries one', () => {
    const ts = serializeConfig(threaded())
    expect((ts.match(/chain: 'her side'/g) ?? [])).toHaveLength(2)
  })

  it('emits the chain block with the settings and the thread', () => {
    const ts = serializeConfig(threaded())
    expect(ts).toContain('export const PANEL_BUBBLE_CHAINS: BubbleChain[] = [')
    expect(ts).toContain(
      "  { id: 'her side', grow: true, stepMs: 450, rows: 4, sms: false, " +
        "messages: ['Hi', '> You up?'] },",
    )
  })

  // No page has a chain until an author draws one, so that is the state the shipped
  // file is in — an empty multi-line literal would read as something having been deleted.
  it('emits an empty list on one line', () => {
    expect(serializeConfig(seedConfig())).toContain(
      'export const PANEL_BUBBLE_CHAINS: BubbleChain[] = []\n',
    )
  })

  it('carries the chain header prose, which is not recoverable from the data', () => {
    const ts = serializeConfig(seedConfig())
    expect(ts).toContain('the list is derived from them, not')
    // The things a hand-editor cannot infer from the data: that the two linked balloons
    // are stamped from rather than drawn, which end is newest, what decides the column a
    // message lands in, that a composer is spelled as a content kind, and — the one that
    // costs money to get wrong — that `sms` sends for real and reads its number off a
    // balloon that is not in the chain at all.
    expect(ts).toContain('are *templates*, not slots')
    expect(ts).toContain('the newest sit at the bottom')
    expect(ts).toContain('deciding which column a message lands in')
    expect(ts).toContain("content: 'input'")
    expect(ts).toContain('binds the chain to a **real** thread')
    expect(ts).toContain('wheel-picker balloon')
  })

  it('escapes an apostrophe an author typed into a message', () => {
    const cfg = patchChain(threaded(), 'her side', { messages: ["It's me"] })
    expect(serializeConfig(cfg)).toContain('messages: ["It\'s me"]')
  })

  it('rounds a delay to whole milliseconds — a timer has no use for a fraction', () => {
    const cfg = threaded()
    cfg.chains[0].stepMs = 450.6
    expect(serializeConfig(cfg)).toContain('stepMs: 451,')
  })

  it('rounds the row cap too — half a row is not a row', () => {
    const cfg = threaded()
    cfg.chains[0].rows = 4.7
    expect(serializeConfig(cfg)).toContain('rows: 5,')
  })

  it('produces a chain block that re-evaluates back to the same list', () => {
    const cfg = threaded()
    expect(reparse(serializeConfig(cfg)).chains).toEqual(cfg.chains)
  })
})

describe('serializeConfigFile', () => {
  it('prepends the import header to the const blocks', () => {
    const file = serializeConfigFile(seedConfig())
    expect(file.startsWith("import type { PanelBgStyle } from '../panelPatterns'")).toBe(true)
    expect(file).toContain(IMPORT_LINE)
    expect(file).toContain('export const PANEL_IMG_TRANSFORMS: ImgTransform[] = [')
    expect(file).toContain('export const PANEL_BUBBLE_TRANSFORMS: BubbleTransform[] = [')
    expect(file).toContain('export const PANEL_PATTERNS: PanelBgStyle[] = [')
    expect(file).toContain('export const PANEL_GRIDS: PageGrids = {')
  })

  it('produces a body whose literals re-evaluate to the source config', () => {
    const cfg = seedConfig()
    expect(reparse(serializeConfigFile(cfg))).toEqual(cfg)
  })

  /*
   * The guarantee the whole serializer exists to keep. Save POSTs this string to the
   * dev endpoint, which overwrites `layoutConfig.ts` with it verbatim — so anything in
   * that file the serializer does not emit is deleted the first time anyone presses
   * Save, and nothing fails. That already happened once: a paragraph explaining why
   * two bubble pairs ship linked lived only in the file, and a save with nothing
   * changed silently removed it.
   *
   * Asserting the whole file, rather than sampling phrases from it, is the point —
   * a phrase test passes while the sentence around it goes missing. When this fails,
   * the fix is to bring the two into line, usually by copying the file's prose into
   * the header constant in `serialize.ts`; it is never to relax the comparison.
   */
  it('rewrites layoutConfig.ts byte for byte when nothing has changed', () => {
    expect(serializeConfigFile(seedConfig())).toBe(layoutConfigSource)
  })
})
