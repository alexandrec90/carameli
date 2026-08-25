import { describe, expect, it } from 'vitest'

import { patchImg } from '../../skins/comic-book/editor/configOps'
import { cloneConfig, seedConfig } from '../../skins/comic-book/editor/configSeed'
import { hydrateConfig } from '../../skins/comic-book/editor/configHydrate'
import {
  cloneNumberPad,
  coerceNumberPad,
  newNumberPad,
} from '../../skins/comic-book/editor/numberPadValidate'
import {
  numberPadSuffix,
  serializeNumberPad,
} from '../../skins/comic-book/editor/serializeNumberPad'
import { serializeConfig } from '../../skins/comic-book/editor/serialize'
import { newTable } from '../../skins/comic-book/editor/tableValidate'
import type { EditorConfig, NumberPadProjection } from '../../skins/comic-book/editor/types'

function reparseNumberPad(source: string): NumberPadProjection {
  return new Function(`return (${source})`)() as NumberPadProjection
}

function reparseConfig(source: string): EditorConfig {
  const body = source
    .replace(/export const PANEL_IMG_TRANSFORMS: ImgTransform\[\] =/, 'const images =')
    .replace(/export const PANEL_BUBBLE_TRANSFORMS: BubbleTransform\[\] =/, 'const bubbles =')
    .replace(/export const PANEL_PATTERNS: PanelBgStyle\[\] =/, 'const patterns =')
    .replace(/export const PANEL_GRIDS: PageGrids =/, 'const grids =')
  return new Function(`${body}\nreturn { images, bubbles, grids, patterns }`)() as EditorConfig
}

describe('number-pad config', () => {
  it('starts visible and hands each image its own quad', () => {
    const first = newNumberPad()
    first.quad[0][0] = 42
    expect(newNumberPad().quad[0][0]).not.toBe(42)
    expect(first.fontScale).toBeGreaterThan(0)
  })

  it('repairs persisted values around a valid quad', () => {
    const pad = coerceNumberPad({
      quad: [[-500, 0], [100, 0], [100, 100], [0, 900]],
      fontScale: 99,
      ink: 42,
    })
    expect(pad?.quad[0][0]).toBe(-100)
    expect(pad?.quad[3][1]).toBe(200)
    expect(pad?.fontScale).toBe(1)
    expect(pad?.ink).toBe('#1b3a8f')
  })

  it('rejects missing or malformed projection geometry', () => {
    expect(coerceNumberPad(undefined)).toBeUndefined()
    expect(coerceNumberPad(null)).toBeUndefined()
    expect(coerceNumberPad({ quad: [[0, 0]] })).toBeUndefined()
  })

  it('deep-copies corners and leaves ordinary pictures without a key', () => {
    const original = newNumberPad()
    const copy = cloneNumberPad(original)
    copy.quad[0][0] = 1
    expect(original.quad[0][0]).not.toBe(1)
    expect('numberPad' in seedConfig().images[0]).toBe(false)

    const config = seedConfig()
    config.images[0].numberPad = original
    const cloned = cloneConfig(config)
    cloned.images[0].numberPad!.quad[0][0] = 2
    expect(config.images[0].numberPad!.quad[0][0]).not.toBe(2)
  })

  it('keeps one projected-content layer and removes disabled keys', () => {
    let config = patchImg(seedConfig(), 0, { numberPad: newNumberPad() })
    config = patchImg(config, 0, { table: newTable(), numberPad: undefined })
    expect(config.images[0].table).toBeTruthy()
    expect('numberPad' in config.images[0]).toBe(false)

    config = patchImg(config, 0, { table: undefined, numberPad: newNumberPad() })
    expect(config.images[0].numberPad).toBeTruthy()
    expect('table' in config.images[0]).toBe(false)
  })

  it('hydrates a saved number pad and drops one with a broken quad', () => {
    const config = seedConfig()
    config.images[1].numberPad = newNumberPad()
    expect(hydrateConfig(JSON.stringify(config)).images[1].numberPad).toEqual(
      config.images[1].numberPad,
    )
    config.images[1].numberPad = { ...newNumberPad(), quad: 'broken' as never }
    expect('numberPad' in hydrateConfig(JSON.stringify(config)).images[1]).toBe(false)
  })

  it('prefers an existing table if a hand-edited payload names both surfaces', () => {
    const config = seedConfig()
    config.images[2].table = newTable()
    config.images[2].numberPad = newNumberPad()
    const image = hydrateConfig(JSON.stringify(config)).images[2]
    expect(image.table).toBeTruthy()
    expect('numberPad' in image).toBe(false)
  })

  it('serializes only the existing table if an in-memory config names both', () => {
    const config = seedConfig()
    config.images[2].table = newTable()
    config.images[2].numberPad = newNumberPad()
    const image = reparseConfig(serializeConfig(config)).images[2]
    expect(image.table).toBeTruthy()
    expect('numberPad' in image).toBe(false)
  })

  it('serializes a pad precisely and round-trips it through the full config', () => {
    const pad = newNumberPad()
    pad.quad[1][0] = 90.126
    expect(reparseNumberPad(serializeNumberPad(pad))).toEqual({
      ...pad,
      quad: [[10, 10], [90.13, 10], [90, 90], [10, 90]],
    })
    expect(numberPadSuffix(undefined)).toBe('')
    expect(numberPadSuffix(pad)).toContain(', numberPad: {')

    const config = patchImg(seedConfig(), 3, { numberPad: newNumberPad() })
    expect(reparseConfig(serializeConfig(config)).images[3]).toEqual(config.images[3])
  })
})
