import { describe, expect, it } from 'vitest'

import { toolbarLayout } from '../../skins/comic-book/editor/useToolbarColumns'

describe('toolbarLayout', () => {
  it('keeps short control sets in one column', () => {
    expect(toolbarLayout(300, { width: 1280, height: 800 })).toEqual({
      columns: 1,
      width: 246,
    })
  })

  it('adds enough columns to keep tall control sets within half the viewport', () => {
    expect(toolbarLayout(900, { width: 1280, height: 800 })).toEqual({
      columns: 3,
      width: 710,
    })
  })

  it('limits columns to the viewport width and leaves vertical overflow to the fallback', () => {
    expect(toolbarLayout(900, { width: 500, height: 800 })).toEqual({
      columns: 2,
      width: 478,
    })
  })

  it('always returns a usable column for tiny viewports', () => {
    expect(toolbarLayout(900, { width: 20, height: 20 })).toEqual({
      columns: 1,
      width: 246,
    })
  })
})
