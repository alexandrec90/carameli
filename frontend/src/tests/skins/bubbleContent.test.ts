import { describe, expect, it } from 'vitest'

import {
  BUBBLE_CONTENT_KINDS,
  isDialContent,
  takesPhoneActions,
} from '../../skins/comic-book/bubbleContent'
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

  it('serializes every live content kind so an editor save preserves it', () => {
    for (const content of BUBBLE_CONTENT_KINDS) {
      const ts = serializeConfig(
        patchBubble(seedConfig(), 0, { content, text: 'Authored value' }),
      )
      expect(ts).toContain(`content: '${content}', text: 'Authored value',`)
    }
  })
})

describe('takesPhoneActions', () => {
  it('names the kinds that draw a key the handset’s handlers run', () => {
    expect(takesPhoneActions('actions')).toBe(true)
    expect(takesPhoneActions('number-hangup')).toBe(true)
  })

  it('leaves out the dial, whose green key dials through its own field', () => {
    for (const content of BUBBLE_CONTENT_KINDS.filter(k => !takesPhoneActions(k))) {
      expect(['actions', 'number-hangup']).not.toContain(content)
    }
    expect(takesPhoneActions('dial-call')).toBe(false)
  })
})

describe('isDialContent', () => {
  // Six places used to spell this comparison out for themselves — the projected keypad's
  // target, the SMS peer, the keyboard reveal, the render branch, the Enter binding, the
  // inspector's hint. They ask here now, so a kind that is a dial is a dial to all of them.
  it('covers both dial kinds, since the call key is their only difference', () => {
    expect(isDialContent('dial')).toBe(true)
    expect(isDialContent('dial-call')).toBe(true)
  })

  it('is false for every other kind, including the wheel a dial is built on', () => {
    for (const content of BUBBLE_CONTENT_KINDS.filter(k => !k.startsWith('dial'))) {
      expect(isDialContent(content)).toBe(false)
    }
  })
})
