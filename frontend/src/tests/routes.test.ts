import { describe, expect, it } from 'vitest'
import { NAV_ITEMS, ROUTES } from '../routes'

describe('ROUTES', () => {
  it('has unique paths', () => {
    const paths = ROUTES.map((r) => r.path)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('gives every route a label and an element', () => {
    for (const route of ROUTES) {
      expect(route.label).toBeTruthy()
      expect(route.element).toBeTruthy()
    }
  })

  it('routes the extension-variant and conference/parking pages', () => {
    const paths = ROUTES.map((r) => r.path)
    expect(paths).toContain('/group-extensions')
    expect(paths).toContain('/intercom')
    expect(paths).toContain('/multicast-intercom')
    expect(paths).toContain('/conferences')
    expect(paths).toContain('/call-parking')
  })

  it('mirrors every route into NAV_ITEMS without leaking components', () => {
    expect(NAV_ITEMS).toHaveLength(ROUTES.length)
    for (const item of NAV_ITEMS) {
      expect(Object.keys(item).sort()).toEqual(['label', 'path'])
    }
  })
})
