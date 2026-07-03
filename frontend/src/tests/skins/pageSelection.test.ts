import { describe, expect, it } from 'vitest'

import {
  LOADING_PAGE_VALUE,
  pageSelectValue,
  resolvePageSelection,
} from '../../skins/comic-book/editor/pageSelection'

describe('pageSelectValue', () => {
  it('shows the current route when not previewing', () => {
    expect(pageSelectValue(false, '/phone-lines')).toBe('/phone-lines')
  })

  it('shows the loading sentinel while previewing the loading screen', () => {
    expect(pageSelectValue(true, '/phone-lines')).toBe(LOADING_PAGE_VALUE)
  })
})

describe('resolvePageSelection', () => {
  it('turns on the loading preview without navigating', () => {
    expect(resolvePageSelection(LOADING_PAGE_VALUE, '/')).toEqual({
      previewLoading: true,
      navigateTo: null,
    })
  })

  it('navigates to a different page and turns the preview off', () => {
    expect(resolvePageSelection('/extensions', '/')).toEqual({
      previewLoading: false,
      navigateTo: '/extensions',
    })
  })

  it('re-selecting the current page only exits the preview (no navigation)', () => {
    expect(resolvePageSelection('/', '/')).toEqual({
      previewLoading: false,
      navigateTo: null,
    })
  })
})
