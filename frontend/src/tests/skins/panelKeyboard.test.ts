import { describe, expect, it } from 'vitest'

import {
  bubbleClaim, bubbleKey, chainClaim, chainKey, CLAIM_COMPOSER, CLAIM_FIELD, CLAIM_NONE,
  CLAIM_POINTER, keyboardOwner,
} from '../../skins/comic-book/panelKeyboard'

// The hierarchy a panel uses to decide where a keystroke goes. It is one rule for every
// field on the page rather than a dial's own behaviour plus a composer's own behaviour,
// so the interesting cases are all about *how many* fields are drawn beside each other.

const field = (key: string, claim: number) => ({ key, claim })

describe('what each content kind claims', () => {
  it('counts every real field as a field, whichever kind it is', () => {
    expect(bubbleClaim('input')).toBe(CLAIM_FIELD)
    expect(bubbleClaim('phone')).toBe(CLAIM_FIELD)
    expect(bubbleClaim('dial')).toBe(CLAIM_FIELD)
    expect(bubbleClaim('dial-call')).toBe(CLAIM_FIELD)
  })

  it('lets a wheel claim the panel under the pointer and never by default', () => {
    // No field to type into, but it does take the scroll — so a composer beside it has
    // to let go while the reader is turning the drum.
    expect(bubbleClaim('wheel')).toBe(CLAIM_POINTER)
  })

  it('claims nothing for lettering or the telephone keys', () => {
    expect(bubbleClaim('text')).toBe(CLAIM_NONE)
    expect(bubbleClaim('actions')).toBe(CLAIM_NONE)
  })

  it('claims for a conversation only when its sender template is a composer', () => {
    expect(chainClaim('input')).toBe(CLAIM_COMPOSER)
    expect(chainClaim('phone')).toBe(CLAIM_COMPOSER)
    // An authored animation has no field in it, so there is nothing to type into.
    expect(chainClaim('text')).toBe(CLAIM_NONE)
  })
})

describe('who owns a revealed panel’s keyboard', () => {
  it('gives it to a lone field with no gesture at all', () => {
    // The whole point of the change: a panel with one field needs no click, whatever
    // kind of field it is and wherever it was drawn.
    expect(keyboardOwner([field('a', CLAIM_FIELD)], null)).toBe('a')
  })

  it('gives it to nobody when two fields of equal standing are drawn', () => {
    // Guessing would post every keystroke into whichever balloon happens to come first
    // in the config, which is not a fact about the panel the reader can see.
    expect(keyboardOwner([field('a', CLAIM_FIELD), field('b', CLAIM_FIELD)], null)).toBeNull()
  })

  it('prefers a conversation’s composer to a plain field beside it', () => {
    const claims = [field('dial', CLAIM_FIELD), field('chain', CLAIM_COMPOSER)]
    expect(keyboardOwner(claims, null)).toBe('chain')
  })

  it('hands it to whatever the pointer is on, outranking any default', () => {
    const claims = [field('dial', CLAIM_FIELD), field('chain', CLAIM_COMPOSER)]
    expect(keyboardOwner(claims, 'dial')).toBe('dial')
    // And back again the moment the pointer leaves, which the caller spells as null.
    expect(keyboardOwner(claims, null)).toBe('chain')
  })

  it('lets a hovered wheel take the keyboard off a composer', () => {
    const claims = [field('wheel', CLAIM_POINTER), field('chain', CLAIM_COMPOSER)]
    expect(keyboardOwner(claims, 'wheel')).toBe('wheel')
  })

  it('leaves a panel of nothing but a wheel unclaimed', () => {
    expect(keyboardOwner([field('wheel', CLAIM_POINTER)], null)).toBeNull()
  })

  it('ignores a hover on something that claims nothing', () => {
    // Lettering does not report a hover, but a chain that claims nothing still does —
    // the pointer resting on somebody's messages must not blank the composer beside it.
    const claims = [field('a', CLAIM_FIELD)]
    expect(keyboardOwner(claims, 'chain:quiet')).toBe('a')
  })

  it('owns nothing on a panel with no fields on it', () => {
    expect(keyboardOwner([], null)).toBeNull()
    expect(keyboardOwner([field('a', CLAIM_NONE)], null)).toBeNull()
  })

  it('keys balloons and conversations apart, since a panel holds both', () => {
    expect(bubbleKey(2)).not.toBe(chainKey('2'))
  })
})
