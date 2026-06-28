import { describe, expect, it } from 'vitest'

import { BUBBLE_TYPES, BUBBLE_TYPE_KEYS } from '../../skins/comic-book/editor/bubbleTypes'
import {
  PANEL_IMG_TRANSFORMS,
  PANEL_BUBBLE_TRANSFORMS,
} from '../../skins/comic-book/editor/layoutConfig'
import {
  imgTransformStyle,
  bubbleStyle,
} from '../../skins/comic-book/editor/transforms'

describe('imgTransformStyle', () => {
  it('builds the expected CSS for a sample transform', () => {
    const style = imgTransformStyle({
      scale: 1.5,
      offsetX: 10,
      offsetY: -20,
      anchor: 'center bottom',
      spill: false,
    })
    expect(style.objectFit).toBe('cover')
    expect(style.objectPosition).toBe('center bottom')
    expect(style.transform).toBe('translate(10px, -20px) scale(1.5)')
    expect(style.transformOrigin).toBe('center center')
  })

  it('reproduces the identity framing at scale 1 / offset 0', () => {
    const style = imgTransformStyle({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      anchor: 'center center',
      spill: false,
    })
    expect(style.transform).toBe('translate(0px, 0px) scale(1)')
    expect(style.objectPosition).toBe('center center')
  })
})

describe('bubbleStyle', () => {
  it('maps the bubble transform to percentages and the rotation custom property', () => {
    const style = bubbleStyle({
      top: -35,
      right: -12,
      width: 55,
      rotate: -5,
      spill: true,
      type: 'soft',
      text: 'hi',
    }) as Record<string, string>
    expect(style.top).toBe('-35%')
    expect(style.right).toBe('-12%')
    expect(style.width).toBe('55%')
    expect(style['--cb-bubble-rot']).toBe('-5deg')
  })
})

describe('BUBBLE_TYPES', () => {
  it('resolves a src + font for every type used by the default config', () => {
    PANEL_BUBBLE_TRANSFORMS.forEach(b => {
      const def = BUBBLE_TYPES[b.type]
      expect(def).toBeDefined()
      expect(def.src).toMatch(/^\/comic-book\/.+\.webp$/)
      expect(typeof def.font).toBe('string')
    })
  })

  it('lists every registry key in display order', () => {
    expect(BUBBLE_TYPE_KEYS).toEqual(['soft', 'cloud', 'lightning', 'jagged'])
    expect(BUBBLE_TYPE_KEYS).toHaveLength(Object.keys(BUBBLE_TYPES).length)
  })
})

describe('default config parity', () => {
  it('uses center center only for the logo and center bottom for the rest', () => {
    expect(PANEL_IMG_TRANSFORMS[0].anchor).toBe('center center')
    PANEL_IMG_TRANSFORMS.slice(1).forEach(t => {
      expect(t.anchor).toBe('center bottom')
    })
  })

  it('keeps every image transform at identity framing', () => {
    PANEL_IMG_TRANSFORMS.forEach(t => {
      expect(t.scale).toBe(1)
      expect(t.offsetX).toBe(0)
      expect(t.offsetY).toBe(0)
    })
  })

  it('defaults every bubble to today\'s CSS geometry and floating spill', () => {
    PANEL_BUBBLE_TRANSFORMS.forEach(b => {
      expect(b.top).toBe(-35)
      expect(b.right).toBe(-12)
      expect(b.width).toBe(55)
      expect(b.rotate).toBe(-5)
      expect(b.spill).toBe(true)
      expect(b.text.length).toBeGreaterThan(0)
    })
  })

  it('has one transform per panel (length 8)', () => {
    expect(PANEL_IMG_TRANSFORMS).toHaveLength(8)
    expect(PANEL_BUBBLE_TRANSFORMS).toHaveLength(8)
  })
})
