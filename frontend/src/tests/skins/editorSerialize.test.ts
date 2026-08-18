import { describe, expect, it } from 'vitest'

import { patchBubble, patchImg, seedConfig } from '../../skins/comic-book/editor/configOps'
import { PANEL_BUBBLE_TRANSFORMS } from '../../skins/comic-book/editor/layoutConfig'
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
  it('emits both const blocks, one image per panel and every bubble', () => {
    const ts = serializeConfig(seedConfig())
    expect(ts).toContain('export const PANEL_IMG_TRANSFORMS: ImgTransform[] = [')
    expect(ts).toContain('export const PANEL_BUBBLE_TRANSFORMS: BubbleTransform[] = [')
    expect(entryCount(ts, 'PANEL_IMG_TRANSFORMS')).toBe(8)
    expect(entryCount(ts, 'PANEL_BUBBLE_TRANSFORMS')).toBe(PANEL_BUBBLE_TRANSFORMS.length)
  })

  // Save overwrites layoutConfig.ts verbatim, so a rule that lives only in that file's
  // prose is deleted by the first save unless the serializer writes it back out.
  it('carries the explanatory headers, the same-panel link rule included', () => {
    const ts = serializeConfig(seedConfig())
    expect(ts).toContain('// Index parallel to PANEL_IMAGES in Layout.tsx.')
    expect(ts).toContain('must name a bubble on the same panel')
    expect(ts).toContain("`tail` which way the tail points ('none'")
  })

  it('reproduces the default values verbatim', () => {
    const ts = serializeConfig(seedConfig())
    expect(ts).toContain("{ scale: 1, offsetX: 0, offsetY: 0, anchor: 'center center', spill: false },")
    expect(ts).toContain("{ scale: 1, offsetX: 0, offsetY: 0, anchor: 'center bottom', spill: false },")
    expect(ts).toContain(
      '{ panel: 0, top: -35, right: -12, width: 55, rotate: -5, spill: true, ' +
        'type: \'soft\', tail: \'down-left\', text: "It\'s Carameli!", linkTo: 1, ' +
        "hoverType: 'cloud', clickType: 'lightning' },",
    )
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
      scale: 1.0000000002,
      offsetX: 12.4,
      offsetY: -8.7,
    })
    cfg = patchBubble(cfg, 1, { top: -35.49, right: -11.6, width: 54.8, rotate: -4.96 })
    const ts = serializeConfig(cfg)
    expect(ts).not.toMatch(/\d\.\d{3,}/) // no long decimal tails anywhere
    expect(ts).toContain("{ scale: 1, offsetX: 12, offsetY: -9, anchor: 'center bottom', spill: false },")
    expect(ts).toContain('{ panel: 0, top: -35, right: -12, width: 55, rotate: -5, spill: true,')
  })

  it('JSON-escapes bubble text with quotes, backslashes, and newlines', () => {
    const cfg = patchBubble(seedConfig(), 0, { text: 'a "quote"\nand \\ slash' })
    const ts = serializeConfig(cfg)
    expect(ts).toContain('text: "a \\"quote\\"\\nand \\\\ slash"')
  })

  it('keeps two decimals of precision on scale', () => {
    const cfg = patchImg(seedConfig(), 2, { scale: 1.234 })
    expect(serializeConfig(cfg)).toContain('{ scale: 1.23,')
  })

  it('produces a string that re-evaluates back to the same config', () => {
    const cfg = patchBubble(patchImg(seedConfig(), 0, { scale: 1.5, offsetY: -20 }), 0, {
      top: -40,
      width: 60,
    })
    const parsed = reparse(serializeConfig(cfg))
    expect(parsed.images).toHaveLength(8)
    expect(parsed.bubbles).toHaveLength(PANEL_BUBBLE_TRANSFORMS.length)
    expect(parsed.images[0]).toEqual({
      scale: 1.5,
      offsetX: 0,
      offsetY: -20,
      anchor: 'center center',
      spill: false,
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
})
