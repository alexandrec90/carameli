import { describe, expect, it } from 'vitest'

import { BUBBLE_CONTENT_KINDS } from '../../skins/comic-book/bubbleContent'
import {
  NEW_BUBBLE,
  hydrateConfig,
  patchBubble,
  seedConfig,
} from '../../skins/comic-book/editor/configOps'
import { serializeConfig } from '../../skins/comic-book/editor/serialize'

describe('interactive bubble content persistence', () => {
  it('hydrates every live content kind without coercing it back to lettering', () => {
    const bubbles = BUBBLE_CONTENT_KINDS.map(content => ({
      ...NEW_BUBBLE,
      panel: 0,
      content,
      text: 'Authored value',
    }))
    expect(hydrateConfig(JSON.stringify({ images: [], bubbles })).bubbles).toEqual(bubbles)
  })

  it('serializes text and phone inputs so an editor save preserves them', () => {
    for (const content of ['input', 'phone'] as const) {
      const ts = serializeConfig(
        patchBubble(seedConfig(), 0, { content, text: 'Authored value' }),
      )
      expect(ts).toContain(`content: '${content}', text: 'Authored value',`)
    }
  })
})
