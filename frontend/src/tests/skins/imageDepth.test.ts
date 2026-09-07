import { describe, expect, it } from 'vitest'

import {
  clampDepth,
  DEPTH,
  DEPTH_MAX,
  DEPTH_MIN,
  inDepthOrder,
  panelDrawOrder,
} from '../../skins/comic-book/imageDepth'
import { hydrateConfig } from '../../skins/comic-book/editor/configHydrate'
import { seedConfig } from '../../skins/comic-book/editor/configSeed'
import type { CallRole, ImgTransform } from '../../skins/comic-book/editor/types'

// Depth is paint order, and paint order is the order the pictures come back in — so every
// assertion here is about a sequence of config indices. The indices are the point: they
// are what selection, the inspector and Save all name, so an ordering that renumbered the
// author's pictures would be a different bug wearing this one's clothes.

function img(over: Partial<ImgTransform> = {}): ImgTransform {
  return {
    panel: 0,
    src: '/comic-book/logo.webp',
    alt: '',
    left: 0,
    top: 0,
    width: 100,
    height: 100,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    anchor: 'center center',
    spill: false,
    z: 0,
    ...over,
  }
}

/** The config indices, in the order they would be drawn. */
function order(images: ImgTransform[]): number[] {
  return inDepthOrder(images).map(d => d.index)
}

describe('clampDepth', () => {
  it('keeps a depth inside the range the inspector offers', () => {
    expect(clampDepth(0)).toBe(DEPTH_MIN)
    expect(clampDepth(5)).toBe(5)
    expect(clampDepth(DEPTH_MAX)).toBe(DEPTH_MAX)
  })

  it('pulls a hand-edited depth back into it rather than drawing off the stack', () => {
    expect(clampDepth(-3)).toBe(DEPTH_MIN)
    expect(clampDepth(99)).toBe(DEPTH_MAX)
  })

  it('rounds, because depth is a band and not a distance', () => {
    expect(clampDepth(2.4)).toBe(2)
    expect(clampDepth(2.6)).toBe(3)
  })

  // A NaN comparator answers neither "before" nor "after", so `sort` leaves the array in
  // whatever order the engine's algorithm happened to touch it in — the whole page
  // scrambled by one bad value rather than one picture misplaced.
  it('reads a non-number as the back of the stack', () => {
    expect(clampDepth(Number.NaN)).toBe(DEPTH_MIN)
    expect(clampDepth(Number.POSITIVE_INFINITY)).toBe(DEPTH_MIN)
    expect(clampDepth(undefined as unknown as number)).toBe(DEPTH_MIN)
  })

  it('exposes the range in the shape the inspector field takes', () => {
    expect(DEPTH).toEqual({ min: DEPTH_MIN, max: DEPTH_MAX, step: 1 })
  })
})

describe('inDepthOrder', () => {
  it('draws a higher depth after — and so over — a lower one', () => {
    expect(order([img({ z: 3 }), img({ z: 0 }), img({ z: 1 })])).toEqual([1, 2, 0])
  })

  // The whole backward-compatibility guarantee: every shipped picture is at the default,
  // so the page must come back in exactly the order the config lists it in.
  it('leaves pictures at equal depth in config order', () => {
    expect(order([img(), img(), img(), img()])).toEqual([0, 1, 2, 3])
  })

  it('is stable within a depth while reordering across depths', () => {
    const images = [img({ z: 1 }), img({ z: 0 }), img({ z: 1 }), img({ z: 0 })]
    expect(order(images)).toEqual([1, 3, 0, 2])
  })

  it('orders by the clamped depth, so a hand-edited outlier still sorts', () => {
    expect(order([img({ z: 50 }), img({ z: -50 }), img({ z: 4 })])).toEqual([1, 2, 0])
  })

  it('does not disturb the array it is given', () => {
    const images = [img({ z: 2 }), img({ z: 1 })]
    inDepthOrder(images)
    expect(images.map(i => i.z)).toEqual([2, 1])
  })
})

describe('panelDrawOrder', () => {
  const roles = (r: CallRole[] | null) => r

  it('draws only the panel it is asked for, in depth order', () => {
    const images = [
      img({ panel: 1, z: 2 }),
      img({ panel: 0, z: 5 }),
      img({ panel: 1, z: 0 }),
      img({ panel: 1, z: 9 }),
    ]
    expect(panelDrawOrder(images, 1, null).map(d => d.index)).toEqual([2, 0, 3])
  })

  // The notepad-and-hand case this exists for: the picture in front is drawn last, so
  // the hand covers the rows projected onto the notepad rather than the other way round.
  it('puts the picture with the higher depth last, over the surface below it', () => {
    const notepad = img({ z: 0, src: '/comic-book/hand-notepad.webp' })
    const hand = img({ z: 1, src: '/comic-book/rolodex.webp' })
    expect(panelDrawOrder([notepad, hand], 0, null).map(d => d.img.src)).toEqual([
      '/comic-book/hand-notepad.webp',
      '/comic-book/rolodex.webp',
    ])
    expect(panelDrawOrder([hand, notepad], 0, null).map(d => d.img.src)).toEqual([
      '/comic-book/hand-notepad.webp',
      '/comic-book/rolodex.webp',
    ])
  })

  it('draws the ordinary layout and never a picture with a call role', () => {
    const images = [img({ z: 1 }), img({ call: 'local' }), img({ z: 0 })]
    expect(panelDrawOrder(images, 0, roles(null)).map(d => d.index)).toEqual([2, 0])
  })

  it('draws a call layout in depth order too', () => {
    const images = [
      img({ call: 'local', z: 3 }),
      img({ z: 0 }),
      img({ call: 'remote', z: 1 }),
      img({ call: 'ringing', z: 0 }),
    ]
    expect(panelDrawOrder(images, 0, roles(['remote', 'local'])).map(d => d.index))
      .toEqual([2, 0])
  })
})

describe('a depth read back from a saved working copy', () => {
  /** A payload of the shipped config with one picture's depth overwritten. */
  function payload(z: unknown): string {
    const config = seedConfig()
    const images = config.images.map((t, i) => (i === 0 ? { ...t, z } : t))
    return JSON.stringify({ ...config, images })
  }

  it('survives a save and a reload', () => {
    expect(hydrateConfig(payload(4)).images[0].z).toBe(4)
  })

  // A payload predating the field at all: every picture comes back at the back of its
  // panel, which is the order the page already drew them in.
  it('defaults a payload written before depth existed', () => {
    const config = seedConfig()
    const images = config.images.map(t => {
      const older: Partial<ImgTransform> = { ...t }
      delete older.z
      return older
    })
    const hydrated = hydrateConfig(JSON.stringify({ ...config, images }))
    expect(hydrated.images.map(t => t.z)).toEqual(config.images.map(() => 0))
  })

  it('repairs a hand-edited depth rather than handing sort a value it cannot order', () => {
    expect(hydrateConfig(payload('front')).images[0].z).toBe(DEPTH_MIN)
    expect(hydrateConfig(payload(1000)).images[0].z).toBe(DEPTH_MAX)
    expect(hydrateConfig(payload(null)).images[0].z).toBe(DEPTH_MIN)
  })
})
