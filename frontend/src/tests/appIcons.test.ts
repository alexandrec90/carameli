import { describe, expect, test } from 'vitest'

import html from '../../index.html?raw'
import manifest from '../../public/manifest.json'

// Icons are static assets under public/, so nothing imports them and no other test
// would notice if a file were renamed or dropped — the browser would just fall back
// to a blank tab icon. Assert the declarations and the files on disk agree.
//
// import.meta.glob resolves at build time against the real directory, so a key is
// present only if the file is.
const onDisk = new Set(Object.keys(import.meta.glob('../../public/**/*.{png,ico}')))

const exists = (href: string) => onDisk.has(`../../public${href}`)

describe('index.html icon declarations', () => {
  test('declares the .ico plus both PNG favicon sizes and the apple-touch icon', () => {
    expect(html).toContain('<link rel="icon" href="/favicon.ico" sizes="any" />')
    expect(html).toContain('sizes="16x16" href="/icons/favicon-16.png"')
    expect(html).toContain('sizes="32x32" href="/icons/favicon-32.png"')
    expect(html).toContain(
      'rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png"',
    )
  })

  test('every href it points at exists', () => {
    const declared = [
      ...html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]*href="([^"]+)"/g),
    ].map((m) => m[1])
    expect(declared.length).toBeGreaterThanOrEqual(4)
    for (const href of declared) {
      expect(exists(href), `${href} is declared but missing from public/`).toBe(true)
    }
  })
})

describe('manifest.json icons', () => {
  test('every listed icon file exists', () => {
    expect(manifest.icons.length).toBeGreaterThan(0)
    for (const icon of manifest.icons) {
      expect(exists(icon.src), `${icon.src} is listed but missing from public/`).toBe(true)
    }
  })

  test('ships a maskable icon so Android does not crop the letters', () => {
    const maskable = manifest.icons.filter(
      (icon) => ('purpose' in icon ? icon.purpose : undefined)?.split(' ').includes('maskable'),
    )
    expect(maskable).toHaveLength(1)
    expect(maskable[0].sizes).toBe('512x512')
  })
})
