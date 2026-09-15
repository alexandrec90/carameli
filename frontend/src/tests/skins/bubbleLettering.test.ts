import { describe, expect, it } from 'vitest'

import { FRAME_HEIGHT_VAR } from '../../skins/comic-book/usePageFrame'
import { cssRules, SKIN_CSS } from './skinCss'

// Balloon lettering follows the page frame, as the balloons do. The words used to be
// `clamp(0.75rem, 2vw, 1.125rem)`: pinned at 18px above a 900px-wide window while the
// balloon boxes kept scaling with the frame, and measured against a viewport that a
// letterboxed frame does not fill — so on a wide monitor the balloons grew and the words
// did not, and on a wide-but-short one the words outgrew their balloons. Now every
// balloon text rule takes `--cb-lettering`, one share of the frame height Layout sets.

const ROOT = SKIN_CSS['src/skins/comic-book/comic-book.css']

/** The selectors that letter a balloon, with the file each lives in. */
const LETTERED: [string, string][] = [
  ['.cb-panel-bubble-text', 'src/skins/comic-book/bubbles.css'],
  ['.cb-bubble-input', 'src/skins/comic-book/bubbleInputs.css'],
  ['.cb-bubble-actions', 'src/skins/comic-book/bubbleInputs.css'],
]

function declarationOf(css: string, selector: string, property: string): string | undefined {
  const rule = cssRules(css).find(r => r.selector === selector)
  const match = rule?.body.match(new RegExp(`${property}\\s*:\\s*([^;]+);`))
  return match?.[1].trim()
}

describe('balloon lettering', () => {
  it('is one token, a share of the frame height the page hands the stylesheet', () => {
    const token = declarationOf(ROOT, '.cb-root', '--cb-lettering')
    // A multiple of the frame height, with a px fallback for a page that has not been
    // handed one yet — and no viewport unit anywhere in it.
    expect(token).toMatch(new RegExp(`^calc\\(var\\(${FRAME_HEIGHT_VAR}, \\d+px\\) \\* [\\d.]+\\)$`))
  })

  it.each(LETTERED)('%s takes the token and nothing viewport-relative', (selector, file) => {
    expect(declarationOf(SKIN_CSS[file], selector, 'font-size')).toBe('var(--cb-lettering)')
  })

  it('leaves no viewport unit anywhere a balloon is styled', () => {
    for (const file of ['src/skins/comic-book/bubbles.css', 'src/skins/comic-book/bubbleInputs.css']) {
      expect(SKIN_CSS[file]).not.toMatch(/\d(vw|vh)\b/)
      expect(SKIN_CSS[file]).not.toMatch(/clamp\(/)
    }
  })
})
