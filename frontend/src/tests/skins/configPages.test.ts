import { describe, expect, it } from 'vitest'

import {
  normalizePageLabels,
  setPageLabel,
} from '../../skins/comic-book/editor/configPages'
import { seedConfig } from '../../skins/comic-book/editor/configSeed'

describe('normalizePageLabels', () => {
  it('keeps string labels keyed by route paths', () => {
    expect(normalizePageLabels({ '/': 'Front Desk', '/calls': 'The Ledger' })).toEqual({
      '/': 'Front Desk',
      '/calls': 'The Ledger',
    })
  })

  it('drops malformed records, non-route keys, and non-string labels', () => {
    expect(normalizePageLabels(null)).toEqual({})
    expect(normalizePageLabels([])).toEqual({})
    expect(normalizePageLabels({ dashboard: 'Front Desk', '/calls': 7 })).toEqual({})
  })
})

describe('setPageLabel', () => {
  it('renames one route in a copy and leaves the canonical path unchanged', () => {
    const config = seedConfig()
    const renamed = setPageLabel(config, '/phone-lines', 'The Hotline')

    expect(renamed.pageLabels).toEqual({ '/phone-lines': 'The Hotline' })
    expect(config.pageLabels).toEqual({})
  })
})
