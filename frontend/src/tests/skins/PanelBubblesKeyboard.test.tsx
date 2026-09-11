import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import PanelBubbles from '../../skins/comic-book/PanelBubbles'
import { NEW_BUBBLE } from '../../skins/comic-book/editor/configSeed'
import type { BubbleTransform } from '../../skins/comic-book/editor/types'
import { idleSms } from './smsStub'

// A field in a comic panel is typed into the moment the panel lights up — there is no
// click-to-focus ritual on a page drawn as artwork. This is that rule applied to every
// balloon rather than to the two it was first written for (the SMS composer and the
// telephone's dial): an `input` balloon drawn anywhere gets the same treatment, and a
// panel holding several of them lets the pointer say which one.

/** The box a balloon's percentages are measured against — the panel's, or half of one. */
const PANEL_BOX = { x: 0, y: 0, w: 400, h: 300 }

const bubble = (over: Partial<BubbleTransform> = {}): BubbleTransform => ({
  ...NEW_BUBBLE,
  panel: 0,
  text: '',
  ...over,
})

/** The panel as an element, so a test can re-render it with the reveal turned off. */
function panel(bubbles: BubbleTransform[], visible = true, interactive = true) {
  return (
    <PanelBubbles
      bubbles={bubbles}
      chains={[]}
      panel={0}
      bounds={PANEL_BOX}
      clip="none"
      isVisible={() => visible}
      interactive={interactive}
      editing={false}
      sms={idleSms()}
    />
  )
}

function draw(bubbles: BubbleTransform[], visible = true, interactive = true) {
  const view = render(panel(bubbles, visible, interactive))
  const balloons = () => Array.from(view.container.querySelectorAll('.cb-panel-bubble'))
  return {
    ...view,
    fields: () => screen.getAllByRole('textbox') as HTMLInputElement[],
    /** Move the pointer onto balloon `k`, in the order the config draws them. */
    enter: (k: number) => fireEvent.pointerEnter(balloons()[k]),
    leave: (k: number) => fireEvent.pointerLeave(balloons()[k]),
  }
}

describe('a panel with one field on it', () => {
  it('types into it as soon as the panel reveals it, whatever kind of field it is', () => {
    const { fields } = draw([bubble({ content: 'input', text: 'Your name' })])

    expect(document.activeElement).toBe(fields()[0])
  })

  it('does the same for a lone phone balloon', () => {
    const { fields } = draw([bubble({ content: 'phone' })])

    expect(document.activeElement).toBe(fields()[0])
  })

  it('leaves it alone while the panel is not revealed', () => {
    // Hidden balloons are still rendered — they fade rather than unmount — so a field
    // that grabbed the keyboard here would answer for a panel nobody is pointing at.
    const { fields } = draw([bubble({ content: 'input', text: 'Your name' })], false)

    expect(document.activeElement).not.toBe(fields()[0])
  })

  it('leaves it alone while the editor owns the balloon', () => {
    const { fields } = draw([bubble({ content: 'input', text: 'Your name' })], true, false)

    expect(document.activeElement).not.toBe(fields()[0])
  })
})

describe('a panel with two fields of equal standing', () => {
  const twoInputs = () => [
    bubble({ content: 'input', text: 'First' }),
    bubble({ content: 'input', text: 'Second' }),
  ]

  it('types into the main one — the first drawn — with no gesture at all', () => {
    const { fields } = draw(twoInputs())

    expect(document.activeElement).toBe(fields()[0])
    expect(document.activeElement).not.toBe(fields()[1])
  })

  it('lends it to whichever one is hovered, and takes it back on the way out', () => {
    const { fields, enter, leave } = draw(twoInputs())

    enter(1)
    expect(document.activeElement).toBe(fields()[1])

    // Hovering out of the other field returns the panel to its main one, rather than
    // leaving the lit panel with nothing to type into.
    leave(1)
    expect(document.activeElement).toBe(fields()[0])
  })

  it('follows a pointer that crosses straight from one balloon to the other', () => {
    // The arrival is reported before the departure, so a leave that cleared the owner
    // blindly would drop the field the pointer had just reached.
    const { fields, enter, leave } = draw(twoInputs())

    enter(0)
    enter(1)
    leave(0)

    expect(document.activeElement).toBe(fields()[1])
  })
})

describe('a panel with a field and a drum', () => {
  const fieldAndWheel = () => [
    bubble({ content: 'input', text: 'Say something' }),
    bubble({ content: 'wheel', text: '5550001111, 5550002222' }),
  ]

  it('still types into the field, since a drum is not somewhere to type', () => {
    const { fields } = draw(fieldAndWheel())

    expect(document.activeElement).toBe(fields()[0])
  })

  it('lets the drum take the keyboard while the pointer is on it', () => {
    // The scroll is the drum's while it is hovered, and a field that kept the keyboard
    // would be answering for a balloon the reader has left.
    const { fields, enter, leave } = draw(fieldAndWheel())

    enter(1)
    expect(document.activeElement).not.toBe(fields()[0])

    leave(1)
    expect(document.activeElement).toBe(fields()[0])
  })
})

/** Let the restore's deferred frame run, and any state it settles with it. */
async function frame(): Promise<void> {
  await act(async () => {
    await new Promise(resolve => {
      requestAnimationFrame(() => resolve(undefined))
    })
  })
}

describe('a field whose panel is still lit', () => {
  const lone = () => [bubble({ content: 'input', text: 'Your name' })]

  it('takes the keyboard back when a press lands on nothing focusable', async () => {
    // The artwork, the panel ground, a balloon's own outline: none of them is somewhere
    // to type, so a press on one must not leave the lit panel with a dead field in it.
    const { fields } = draw(lone())
    const input = fields()[0]
    expect(document.activeElement).toBe(input)

    await act(async () => input.blur())
    await frame()

    expect(document.activeElement).toBe(input)
  })

  it('restores the caret where the reader left it, not at the end', async () => {
    // A stray press must not silently move where the next keystroke lands.
    const { fields } = draw(lone())
    const input = fields()[0]
    fireEvent.change(input, { target: { value: 'Barbara Gordon' } })
    input.setSelectionRange(7, 7)

    await act(async () => input.blur())
    await frame()

    expect(document.activeElement).toBe(input)
    expect(input.selectionStart).toBe(7)
  })

  it('lets a deliberate move to another control have the keyboard', async () => {
    // Tab, or a press on the telephone's call key: focus names where it went, and this
    // is not entitled to drag it back — that would trap the keyboard on this one field.
    const { fields } = draw(lone())
    const input = fields()[0]
    const elsewhere = document.createElement('button')
    document.body.appendChild(elsewhere)

    await act(async () => {
      elsewhere.focus()
      input.dispatchEvent(new FocusEvent('focusout', { relatedTarget: elsewhere }))
    })
    await frame()

    expect(document.activeElement).toBe(elsewhere)
    elsewhere.remove()
  })

  it('does not chase the keyboard once the panel has gone dark', async () => {
    // The pointer leaving is the reason a field stops being typed into, and a blur
    // racing that must not undo it.
    const { fields, rerender } = draw(lone())
    const input = fields()[0]

    await act(async () => input.blur())
    rerender(panel(lone(), false))
    await frame()

    expect(document.activeElement).not.toBe(input)
  })
})
