import { describe, expect, it } from 'vitest'

import { addImg, patchBubble, patchImg, seedConfig } from '../../skins/comic-book/editor/configOps'
import {
  PANEL_BUBBLE_TRANSFORMS,
  PANEL_IMG_TRANSFORMS,
} from '../../skins/comic-book/editor/layoutConfig'
// The file the Save button overwrites, as text — the only way to assert that a save
// with nothing changed rewrites it byte for byte.
import layoutConfigSource from '../../skins/comic-book/editor/layoutConfig.ts?raw'
import { serializeConfig, serializeConfigFile } from '../../skins/comic-book/editor/serialize'
import type { EditorConfig } from '../../skins/comic-book/editor/types'

/** Count `{ ... }` object entries inside the named const's array literal. */
function entryCount(ts: string, constName: string): number {
  const after = ts.slice(ts.indexOf(`export const ${constName}`))
  const start = after.indexOf('= [') + 2 // skip past the `ImgTransform[]` type annotation
  const arr = after.slice(start, after.indexOf(']', start))
  return (arr.match(/\{/g) ?? []).length
}

/** Evaluate a serialized block back into a config, as a paste into the file would. */
function reparse(ts: string): EditorConfig {
  const body = ts
    .replace("import type { ImgTransform, BubbleTransform } from './types'", '')
    .replace(/export const PANEL_IMG_TRANSFORMS: ImgTransform\[\] =/, 'const images =')
    .replace(/export const PANEL_BUBBLE_TRANSFORMS: BubbleTransform\[\] =/, 'const bubbles =')
  return new Function(`${body}\nreturn { images, bubbles }`)() as EditorConfig
}

describe('serializeConfig', () => {
  it('emits both const blocks, every picture and every bubble', () => {
    const ts = serializeConfig(seedConfig())
    expect(ts).toContain('export const PANEL_IMG_TRANSFORMS: ImgTransform[] = [')
    expect(ts).toContain('export const PANEL_BUBBLE_TRANSFORMS: BubbleTransform[] = [')
    expect(entryCount(ts, 'PANEL_IMG_TRANSFORMS')).toBe(PANEL_IMG_TRANSFORMS.length)
    expect(entryCount(ts, 'PANEL_BUBBLE_TRANSFORMS')).toBe(PANEL_BUBBLE_TRANSFORMS.length)
  })

  // Save overwrites layoutConfig.ts verbatim, so a rule that lives only in that file's
  // prose is deleted by the first save unless the serializer writes it back out.
  it('carries the explanatory headers, the same-panel link rule included', () => {
    const ts = serializeConfig(seedConfig())
    expect(ts).toContain('Not parallel to PANELS: each picture names its `panel`')
    expect(ts).toContain("answer, as a bubble's `spill`")
    // The rule that keeps a picture uncropped lives in this prose and nowhere else in
    // the emitted file, so a save that dropped it would leave the next reader of
    // layoutConfig.ts free to hand-write a height back in.
    expect(ts).toContain('There is no `height`')
    expect(ts).toContain('must name a bubble on the same panel')
    expect(ts).toContain("`tail` which way the tail points ('none'")
    expect(ts).toContain('Two pairs ship linked')
  })

  it('reproduces the default values verbatim', () => {
    const ts = serializeConfig(seedConfig())
    expect(ts).toContain(
      "{ panel: 0, src: '/comic-book/logo.webp', alt: 'Carameli', " +
        'left: 0, top: 20.6, width: 100, spill: false },',
    )
    expect(ts).toContain(
      "{ panel: 1, src: '/comic-book/switchboard.webp', alt: 'Switchboard', " +
        'left: 0, top: 40.7, width: 100, spill: false },',
    )
    expect(ts).toContain(
      '{ panel: 0, top: -35, right: -12, width: 55, rotate: -5, spill: true, ' +
        'type: \'soft\', tail: \'down-left\', text: "It\'s Carameli!", linkTo: 1, ' +
        "hoverType: 'cloud', clickType: 'lightning' },",
    )
  })

  // The frame is the picture's own now, so it is the part a save must carry: an
  // emitter that dropped it would silently snap every picture back onto its panel.
  it('writes the frame a picture was dragged and resized to', () => {
    const ts = serializeConfig(patchImg(seedConfig(), 3, { left: -12.5, top: 20, width: 55 }))
    expect(ts).toContain('left: -12.5, top: 20, width: 55, spill: false },')
  })

  // Three numbers and no fourth. A picture's height is its width over the source's own
  // ratio, so an emitted `height` — or a `scale`, an offset, an `anchor` — would be a
  // second opinion about the shape of a box the source already decides, and the shape
  // it decided against is a crop.
  it('emits no field able to reshape a picture', () => {
    const ts = serializeConfig(seedConfig())
    const imgLines = ts.split('\n').filter(l => l.includes("src: '/comic-book/"))
    expect(imgLines).toHaveLength(PANEL_IMG_TRANSFORMS.length)
    imgLines.forEach(line => {
      expect(line).not.toMatch(/\b(height|scale|offsetX|offsetY|anchor)\b/)
    })
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
    expect(ts).toContain('linkTo: null, hoverType: null, clickType: null },')
    expect(ts).not.toContain("'null'")
  })

  it('rounds float noise out of the output', () => {
    let cfg = patchImg(seedConfig(), 1, {
      // A drag produces percentages with long tails; so does a wheel notch.
      left: 19.999999998,
      top: 20.04,
      width: 55.06,
    })
    cfg = patchBubble(cfg, 1, { top: -35.49, right: -11.6, width: 54.8, rotate: -4.96 })
    const ts = serializeConfig(cfg)
    expect(ts).not.toMatch(/\d\.\d{3,}/) // no long decimal tails anywhere
    expect(ts).toContain('left: 20, top: 20, width: 55.1, spill: false },')
    expect(ts).toContain('{ panel: 0, top: -35, right: -12, width: 55, rotate: -5, spill: true,')
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

  // Frame percentages keep one decimal, not zero: a 400-wide panel resolves 0.1% to
  // sub-pixel, and rounding to integers would visibly nudge a frame on every save.
  it('keeps one decimal of precision on the frame', () => {
    const ts = serializeConfig(patchImg(seedConfig(), 2, { left: 12.34, width: 44.56 }))
    expect(ts).toContain('left: 12.3,')
    expect(ts).toContain('width: 44.6,')
  })

  it('produces a string that re-evaluates back to the same config', () => {
    const cfg = patchBubble(patchImg(seedConfig(), 0, { left: 1.5, top: -20 }), 0, {
      top: -40,
      width: 60,
    })
    const parsed = reparse(serializeConfig(cfg))
    expect(parsed.images).toHaveLength(PANEL_IMG_TRANSFORMS.length)
    expect(parsed.bubbles).toHaveLength(PANEL_BUBBLE_TRANSFORMS.length)
    expect(parsed.images[0]).toEqual({
      ...PANEL_IMG_TRANSFORMS[0],
      left: 1.5,
      top: -20,
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
})

describe('serializeConfigFile', () => {
  it('prepends the type import header to the two const blocks', () => {
    const file = serializeConfigFile(seedConfig())
    expect(file.startsWith("import type { ImgTransform, BubbleTransform } from './types'")).toBe(true)
    expect(file).toContain('export const PANEL_IMG_TRANSFORMS: ImgTransform[] = [')
    expect(file).toContain('export const PANEL_BUBBLE_TRANSFORMS: BubbleTransform[] = [')
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
