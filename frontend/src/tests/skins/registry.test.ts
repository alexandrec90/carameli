import { describe, expect, it, vi } from 'vitest'

import type { Skin } from '../../skins/types'

const mockSkin: Skin = {
  Layout: () => null,
  views: {
    Dashboard: () => null,
    PhoneLines: () => null,
    Extensions: () => null,
    Placeholder: () => null,
    DataPage: () => null,
  },
}

vi.mock('../../skins/carameli', () => ({ default: mockSkin }))
vi.mock('../../skins/barebone', () => ({ default: mockSkin }))
vi.mock('../../skins/candy-shop', () => ({ default: mockSkin }))
vi.mock('../../skins/comic-book', () => ({ default: mockSkin }))

import { DEFAULT_SKIN, resolveSkinName, skinLoaders } from '../../skins/registry'

describe('skin registry', () => {
  it('loads carameli skin without throwing', async () => {
    await expect(skinLoaders.carameli()).resolves.toMatchObject({
      default: mockSkin,
    })
  })

  it('loads barebone skin without throwing', async () => {
    await expect(skinLoaders.barebone()).resolves.toMatchObject({
      default: mockSkin,
    })
  })

  it('falls back gracefully on unknown skin name', () => {
    expect(resolveSkinName('not-a-real-skin')).toBe(DEFAULT_SKIN)
  })

  it('returns an object matching the Skin interface shape', async () => {
    const loaded = await skinLoaders['candy-shop']()

    expect(typeof loaded.default.Layout).toBe('function')
    expect(loaded.default.views).toEqual(
      expect.objectContaining({
        Dashboard: expect.any(Function),
        PhoneLines: expect.any(Function),
        Extensions: expect.any(Function),
        Placeholder: expect.any(Function),
        DataPage: expect.any(Function),
      }),
    )
  })
})
