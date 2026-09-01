import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { cssRules, SKIN_CSS } from './skinCss'

// A loading screen is what a skin's chunk is *not*, so every loader here stays pending:
// the provider then holds the screen under test up for the life of the test.
vi.mock('../../skins/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../skins/registry')>()
  const pending = () => new Promise<never>(() => { })
  return {
    ...actual,
    skinLoaders: Object.fromEntries(actual.SKIN_NAMES.map(name => [name, pending])),
  }
})

import { SkinProvider } from '../../skins/context'
import { skinLoadingConfigs } from '../../skins/registry'

const STYLESHEET = SKIN_CSS['src/skins/comic-book/comic-book.css']

/** The screen's outermost element — the one every legend on it inherits from. */
async function renderLoadingScreen(skin: string): Promise<HTMLElement> {
  localStorage.setItem('skin', skin)
  const { container } = render(<SkinProvider><div>page</div></SkinProvider>)
  // The card is debounced by 200 ms; wait for it so the assertions are made against a
  // screen with its legend on it, which is the state the selection complaint is about.
  await screen.findByText(/LOADING/i)
  return container.firstElementChild as HTMLElement
}

/** The declarations of one selector's rule. */
function ruleFor(selector: string): string {
  const rule = cssRules(STYLESHEET).find(r => r.selector === selector)
  expect(rule, `no \`${selector}\` rule in comic-book.css`).toBeDefined()
  return rule?.body ?? ''
}

describe('loading screens', () => {
  it('draws the comic-book pointer and refuses the selection', async () => {
    const wrapper = await renderLoadingScreen('comic-book')
    const style = wrapper.getAttribute('style') ?? ''

    expect(style).toMatch(/pointer-cursor\.webp/)
    expect(style).toMatch(/user-select:\s*none/)
  })

  it('refuses the selection on a skin that draws no pointer of its own', async () => {
    const wrapper = await renderLoadingScreen('barebone')
    const style = wrapper.getAttribute('style') ?? ''

    expect(skinLoadingConfigs.barebone.cursor).toBeUndefined()
    expect(style).toMatch(/user-select:\s*none/)
  })

  /* The screen renders before the skin's stylesheet exists, so its pointer is spelled out
     in the loading config instead of naming `--cb-cursor-default`. Two spellings of one
     drawing drift apart silently — the loading screen would keep the old artwork or the
     old hotspot, which looks like a custom cursor that failed to load. */
  it('spells the comic-book pointer exactly as the stylesheet does', () => {
    const token = /--cb-cursor-default:\s*([^;]+);/.exec(STYLESHEET)?.[1]

    expect(token).toBeDefined()
    expect(skinLoadingConfigs['comic-book'].cursor).toBe(token)
  })

  /* The in-skin overlay takes no pointer at all (`.cb-root` under it draws the cursor),
     but a drag on the page below still grows a range through its legend. */
  it('keeps the in-skin loading overlay out of the selection', () => {
    expect(ruleFor('.cb-loading-overlay')).toMatch(/user-select:\s*none/)
  })
})
