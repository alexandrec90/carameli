import { describe, expect, it } from 'vitest'

import {
  clampToolbarPos,
  hydrateToolbarPos,
} from '../../skins/comic-book/editor/useToolbarDrag'

const size = { w: 220, h: 300 }
const viewport = { w: 1280, h: 800 }

describe('clampToolbarPos', () => {
  it('passes an in-bounds position through unchanged', () => {
    expect(clampToolbarPos({ x: 100, y: 200 }, size, viewport)).toEqual({ x: 100, y: 200 })
  })

  it('clamps negative coordinates to the top-left edge', () => {
    expect(clampToolbarPos({ x: -50, y: -10 }, size, viewport)).toEqual({ x: 0, y: 0 })
  })

  it('clamps so the whole box stays inside the bottom-right edge', () => {
    expect(clampToolbarPos({ x: 5000, y: 5000 }, size, viewport)).toEqual({
      x: viewport.w - size.w,
      y: viewport.h - size.h,
    })
  })

  it('pins to the origin when the box is larger than the viewport', () => {
    expect(clampToolbarPos({ x: 100, y: 100 }, { w: 2000, h: 2000 }, viewport)).toEqual({
      x: 0,
      y: 0,
    })
  })

  it('allows the exact boundary positions', () => {
    expect(clampToolbarPos({ x: 0, y: 0 }, size, viewport)).toEqual({ x: 0, y: 0 })
    expect(
      clampToolbarPos({ x: viewport.w - size.w, y: viewport.h - size.h }, size, viewport),
    ).toEqual({ x: viewport.w - size.w, y: viewport.h - size.h })
  })
})

describe('hydrateToolbarPos', () => {
  it('parses a valid persisted position', () => {
    expect(hydrateToolbarPos('{"x":12,"y":34}')).toEqual({ x: 12, y: 34 })
  })

  it('accepts zero and negative coordinates (clamping happens separately)', () => {
    expect(hydrateToolbarPos('{"x":0,"y":-5}')).toEqual({ x: 0, y: -5 })
  })

  it('returns null for a missing value', () => {
    expect(hydrateToolbarPos(null)).toBeNull()
  })

  it('returns null for malformed JSON without throwing', () => {
    expect(hydrateToolbarPos('{not json')).toBeNull()
  })

  it('returns null for structurally invalid payloads', () => {
    expect(hydrateToolbarPos('null')).toBeNull()
    expect(hydrateToolbarPos('"str"')).toBeNull()
    expect(hydrateToolbarPos('{"x":12}')).toBeNull()
    expect(hydrateToolbarPos('{"x":"12","y":"34"}')).toBeNull()
  })

  it('returns null for non-finite coordinates', () => {
    expect(hydrateToolbarPos('{"x":null,"y":3}')).toBeNull()
    expect(hydrateToolbarPos('{"x":1e999,"y":3}')).toBeNull()
  })
})
