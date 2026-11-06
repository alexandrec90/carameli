import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { act, render, screen } from '@testing-library/react'
import { MotionGlobalConfig, m, motion } from 'framer-motion'
import type { ComponentProps } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { Layout } from '../../skins/candy-shop/Layout'

/**
 * The candy-shop skin takes framer-motion through `LazyMotion`, and three things keep that
 * true. Importing `motion` puts every gesture and layout feature in the chunk whether the
 * skin uses it or not, which is 48 KB here and is what `framer-motion` 14.10 grew by
 * 12.6 KB; `bundlePolicy.ts` has the measurements. The budget would notice, but as a
 * number. These name the file.
 *
 * The other two failures are quiet in a way a budget cannot see, because both *shrink*
 * the build: an `m.*` outside the provider, and a prop the `domAnimation` set does not
 * carry, each simply stop animating.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const SKIN = resolve(HERE, '../../skins/candy-shop')

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : [path]
  })
}

const SOURCES = sourceFiles(SKIN)
  .filter(path => /\.tsx?$/.test(path))
  .map(path => ({ name: relative(SKIN, path), text: readFileSync(path, 'utf8') }))

/** Named imports from framer-motion in `text`, with any `as` alias dropped. */
function framerImports(text: string): string[] {
  return [...text.matchAll(/import\s*\{([^}]*)\}\s*from\s*'framer-motion'/g)].flatMap(match =>
    match[1]
      .split(',')
      .map(name => name.trim().split(/\s+/)[0])
      .filter(Boolean),
  )
}

/** What `domAnimation` leaves out: on an `m.*` these are accepted and do nothing. */
const DOM_MAX_ONLY_PROP = /<m\.\w+[^>]*?\s(layout|layoutId|drag)(?=[\s=/>])/

type LayoutProps = ComponentProps<typeof Layout>

function renderLayout(children: LayoutProps['children']) {
  const props = { sms: {}, softphone: {} } as unknown as Pick<LayoutProps, 'sms' | 'softphone'>
  return render(
    <MemoryRouter>
      <Layout navItems={[]} {...props}>
        {children}
      </Layout>
    </MemoryRouter>,
  )
}

describe('the scanners themselves', () => {
  it('reads motion out of a named import, aliased or not', () => {
    expect(framerImports("import { motion } from 'framer-motion'")).toEqual(['motion'])
    expect(framerImports("import { m, motion as x } from 'framer-motion'")).toEqual([
      'm',
      'motion',
    ])
    expect(framerImports("import { m } from 'framer-motion'")).toEqual(['m'])
  })

  it('ignores another package', () => {
    expect(framerImports("import { motion } from 'other'")).toEqual([])
  })

  it('finds a domMax prop on its own line, and leaves a lookalike alone', () => {
    expect(DOM_MAX_ONLY_PROP.test('<m.div\n  drag="x"\n/>')).toBe(true)
    expect(DOM_MAX_ONLY_PROP.test('<m.div layout />')).toBe(true)
    expect(DOM_MAX_ONLY_PROP.test('<m.div layoutId="card" />')).toBe(true)
    expect(DOM_MAX_ONLY_PROP.test('<m.div className="layout" />')).toBe(false)
    expect(DOM_MAX_ONLY_PROP.test('<div layout />')).toBe(false)
  })
})

describe('the candy-shop skin source', () => {
  it('has files to scan, so nothing below can pass by reading nothing', () => {
    expect(SOURCES.some(file => file.name === 'Layout.tsx')).toBe(true)
  })

  it.each(SOURCES.map(file => [file.name, file.text]))('%s never imports motion', (_, text) => {
    expect(framerImports(text)).not.toContain('motion')
  })

  it.each(SOURCES.map(file => [file.name, file.text]))(
    '%s uses no prop domAnimation leaves out',
    (_, text) => {
      expect(text).not.toMatch(DOM_MAX_ONLY_PROP)
    },
  )
})

describe('the candy-shop Layout', () => {
  beforeAll(() => {
    // happy-dom cannot finish a real animation, so finish them at once.
    MotionGlobalConfig.instantAnimations = true
  })

  afterAll(() => {
    MotionGlobalConfig.instantAnimations = false
  })

  it('gives what it renders the features to animate with', async () => {
    renderLayout(
      <m.div data-testid="pane" initial={{ opacity: 0 }} animate={{ opacity: 0.5 }} />,
    )

    await act(() => new Promise<void>(resolve => setTimeout(resolve, 50)))

    expect(screen.getByTestId('pane').style.opacity).toBe('0.5')
  })

  it('throws on a motion component, which would undo the split', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => renderLayout(<motion.div />)).toThrow(/LazyMotion/)

    consoleError.mockRestore()
  })
})
