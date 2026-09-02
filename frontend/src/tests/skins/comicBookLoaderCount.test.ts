import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { drawnImageCount, useDrawnImageCount } from '../../skins/comic-book/layoutSource'
import { PANELS, PANEL_CALL_SCENES, PANEL_IMG_TRANSFORMS } from '../../skins/comic-book/editor/layoutConfig'
import { EMPTY_TRANSCRIPT } from '../../lib/callTranscript'
import type { CallScene } from '../../skins/comic-book/phoneActions'
import type { CallSceneLayout, ImgTransform } from '../../skins/comic-book/editor/types'
import type { Panel } from '../../skins/comic-book/panels'

// What the loading overlay is allowed to wait for. `Layout` counts one settle event per
// picture that mounts and lifts the sheet when the count is reached, so this number has to
// be the number of pictures the renderer will actually draw — never the number the config
// lists. A picture that is never mounted fires neither `load` nor `error`, so every extra
// one in this count is a settle that cannot arrive and a page that never appears.
//
// Both exclusions are regressions that have happened: a panel on the other page (fixed when
// the second page landed) and a call-role picture with no call up (#295, which added the
// roles without telling the counter about them, and left `/` on the loading screen forever).

const RINGING: CallScene = { phase: 'ringing', transcript: EMPTY_TRANSCRIPT }

const scenesFor = (panel: number): CallSceneLayout[] => [{ panel, cut: 50, axis: 'x' }]

const PANEL_FIXTURE = [
  { label: 'Here', isLogo: false, page: 'home' },
  { label: 'Away', isLogo: false, page: 'classic' },
] as Panel[]

// A real served file: `assetPolicy.test.ts` scans the source tree for `/comic-book/`
// references and fails on one that public/ does not hold, fixture or not.
const img = (panel: number, call?: ImgTransform['call']): ImgTransform =>
  ({ panel, src: '/comic-book/logo.webp', alt: '', left: 0, top: 0, width: 100, height: 100,
     scale: 1, offsetX: 0, offsetY: 0, anchor: 'center center', spill: false,
     ...(call ? { call } : {}) }) as ImgTransform

describe('drawnImageCount', () => {
  describe('against the shipped layout', () => {
    // The real config, because the bug was a disagreement between it and the counter — a
    // hand-built fixture would have been written to match whichever one the author had in
    // mind and could not have caught it.
    const homeEntries = PANEL_IMG_TRANSFORMS.filter(t => PANELS[t.panel]?.page === 'home')

    it('ignores the call-role pictures on the home page when no call is up', () => {
      const drawn = drawnImageCount(PANEL_IMG_TRANSFORMS, PANELS, 'home', PANEL_CALL_SCENES, null)
      const ordinary = homeEntries.filter(t => t.call === undefined)

      expect(drawn).toBe(ordinary.length)
      // The assertion that fails on the pre-fix counter: the page lists more pictures than
      // it draws, so counting the listing is not the same number.
      expect(drawn).toBeLessThan(homeEntries.length)
    })

    it('counts every picture on the classic page, which has no call layouts', () => {
      const classic = PANEL_IMG_TRANSFORMS.filter(t => PANELS[t.panel]?.page === 'classic')
      const drawn = drawnImageCount(PANEL_IMG_TRANSFORMS, PANELS, 'classic', PANEL_CALL_SCENES, null)

      expect(classic.every(t => t.call === undefined)).toBe(true)
      expect(drawn).toBe(classic.length)
    })
  })

  describe('the two reasons a picture is not drawn', () => {
    const panels = PANEL_FIXTURE

    it('leaves out a picture whose panel is on the other page', () => {
      const images = [img(0), img(1)]

      expect(drawnImageCount(images, panels, 'home', [], null)).toBe(1)
    })

    it('leaves out a call-role picture while no call is up', () => {
      const images = [img(0), img(0, 'ringing'), img(0, 'local')]

      expect(drawnImageCount(images, panels, 'home', scenesFor(0), null)).toBe(1)
    })

    it('swaps to the call layout once a call is up, rather than adding to it', () => {
      const images = [img(0), img(0, 'ringing'), img(0, 'remote'), img(0, 'local')]

      // Ringing draws the far end that is ringing and the caller — not the panel's ordinary
      // picture, and not the far end that has answered.
      expect(drawnImageCount(images, panels, 'home', scenesFor(0), RINGING)).toBe(2)
    })

    it('keeps a call-role picture off a panel the author gave no scene', () => {
      const images = [img(0), img(0, 'ringing')]

      // A role on a panel with no seam is not a call layout, so the panel stays ordinary.
      expect(drawnImageCount(images, panels, 'home', scenesFor(1), RINGING)).toBe(1)
    })
  })
})

// The hook is a boundary rather than arithmetic, and `Layout` has to reach the count through
// it: React Compiler reads a call to a plain function as one that may mutate its arguments,
// and `panels` belongs to the same layout object as the `grids` a memo above it depends on —
// so a direct call marked that dependency "modified later" and made the compiler skip the
// whole component. `preserve-manual-memoization` fails if the boundary is removed; these
// cases hold the hook to the answer the pure function gives.
describe('useDrawnImageCount', () => {
  const images = [img(0), img(0, 'ringing'), img(0, 'local'), img(1)]

  it('gives the pure count its answer', () => {
    const { result } = renderHook(
      () => useDrawnImageCount(images, PANEL_FIXTURE, 'home', scenesFor(0), null))

    expect(result.current).toBe(drawnImageCount(images, PANEL_FIXTURE, 'home', scenesFor(0), null))
    expect(result.current).toBe(1)
  })

  it('re-counts when a call comes up', () => {
    const { result, rerender } = renderHook(
      ({ call }: { call: CallScene | null }) =>
        useDrawnImageCount(images, PANEL_FIXTURE, 'home', scenesFor(0), call),
      { initialProps: { call: null as CallScene | null } })

    expect(result.current).toBe(1)

    rerender({ call: RINGING })

    // Ringing swaps the panel's ordinary picture for the two the phase lights.
    expect(result.current).toBe(2)
  })
})
