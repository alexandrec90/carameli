import { fireEvent, render, screen } from '@testing-library/react'
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

const bubble = (over: Partial<BubbleTransform> = {}): BubbleTransform => ({
  ...NEW_BUBBLE,
  panel: 0,
  text: '',
  ...over,
})

function draw(bubbles: BubbleTransform[], visible = true, interactive = true) {
  const view = render(
    <PanelBubbles
      bubbles={bubbles}
      chains={[]}
      panel={0}
      clip="none"
      isVisible={() => visible}
      interactive={interactive}
      editing={false}
      sms={idleSms()}
    />,
  )
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

  it('gives the keyboard to neither until the pointer picks one', () => {
    const { fields } = draw(twoInputs())

    expect(document.activeElement).not.toBe(fields()[0])
    expect(document.activeElement).not.toBe(fields()[1])
  })

  it('hands it to whichever one is hovered, and takes it back on the way out', () => {
    const { fields, enter, leave } = draw(twoInputs())

    enter(0)
    expect(document.activeElement).toBe(fields()[0])

    leave(0)
    enter(1)
    expect(document.activeElement).toBe(fields()[1])

    leave(1)
    expect(document.activeElement).not.toBe(fields()[1])
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
