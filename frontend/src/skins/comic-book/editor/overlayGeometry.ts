import { useMemo } from 'react'
import type { CSSProperties } from 'react'

import { splitAt } from '../callSceneGeometry'
import type { SceneHalves } from '../callSceneGeometry'
import { halfFor, inRoles, rolesAtPhase } from '../callSceneRoles'
import type { PanelPoly, Rect } from '../panelGeometry'
import type { CallScenePhase } from '../phoneActions'
import { bubbleRect, imgVisibleRect } from './transforms'
import type {
  BubbleTransform, CallRole, CallSceneLayout, ImgTransform,
} from './types'
import type { EditorModeApi } from './useEditorMode'

// What the overlay has to work out before it can draw anything: which call layout is up,
// where each call panel's seam falls, and the box the selection occupies. None of it is
// markup, and all of it is asked by more than one layer, so it lives here rather than in
// EditorOverlay.tsx.

/** A rect as the absolute positioning every overlay layer uses. */
export function rectStyle(r: Rect): CSSProperties {
  return { left: r.x, top: r.y, width: r.w, height: r.h }
}

/**
 * The box an entry is placed against: its half of a call, or the panel itself. The same
 * answer PanelImages and PanelBubbles get from `halfFor`, which is the point — a target
 * measured against the panel while the drawing is measured against a half is a target
 * that sits somewhere its picture is not.
 */
export function boxOf(
  entry: { call?: CallRole },
  bounds: Rect,
  halves: SceneHalves | null,
): Rect {
  return halfFor(entry.call, halves)?.box ?? bounds
}

/** The halves of the call on one panel, or null when that panel has none showing. */
export type HalvesOn = (panel: number) => SceneHalves | null

/**
 * Which layout the page's calls are showing, and where each one's seam falls — the same
 * two facts ComicPanel works out for itself, because the overlay is not inside a panel and
 * there is nothing to hand it down. `null` roles is the ordinary layout, and then every
 * call entry is off screen and has no target.
 */
export function useCallOverlay(
  callPhase: CallScenePhase | null,
  callScenes: CallSceneLayout[],
  panelPolys: (PanelPoly | null)[],
): { callRoles: CallRole[] | null; halvesOn: HalvesOn } {
  const callRoles = callPhase === null ? null : rolesAtPhase(callPhase)
  const halvesByPanel = useMemo(() => {
    const out = new Map<number, SceneHalves>()
    if (callPhase === null) return out
    for (const scene of callScenes) {
      const poly = panelPolys[scene.panel]
      if (poly) out.set(scene.panel, splitAt(poly.vp, poly.bounds, scene.cut, scene.axis))
    }
    return out
  }, [callPhase, callScenes, panelPolys])
  return { callRoles, halvesOn: panel => halvesByPanel.get(panel) ?? null }
}

/**
 * The panel a selection sits on. Everything drawn is placed against the panel it *names*,
 * never against a panel that shares its index — those parted company once a panel could
 * own several of each. A `panel` selection is the panel itself, and is how "which panel
 * does a new picture or bubble go on" gets an answer without a second click.
 */
function panelOfSelection(
  selected: EditorModeApi['selected'],
  img: ImgTransform | null,
  bubble: BubbleTransform | null,
): number | null {
  if (selected === null) return null
  if (selected.kind === 'panel') return selected.index
  return img?.panel ?? bubble?.panel ?? null
}

/** The rect a drawn selection occupies, once it is known to be on screen. */
function entryRect(
  img: ImgTransform | null,
  bubble: BubbleTransform | null,
  poly: PanelPoly,
  halves: SceneHalves | null,
  natSizes: Record<string, { w: number; h: number }>,
): Rect {
  if (img) return imgVisibleRect(boxOf(img, poly.bounds, halves), natSizes[img.src], img)
  if (bubble) return bubbleRect(boxOf(bubble, poly.bounds, halves), bubble)
  return poly.bounds
}

/** Everything the overlay's outline and grips are placed from. */
export interface OverlaySelection {
  selImg: ImgTransform | null
  /** The panel the selection sits on — where "+ Image" and "+ Bubble" add. */
  selPanel: number | null
  /** That panel's polygon, or null when the panel is on the other page. */
  selPoly: PanelPoly | null
  /** The halves of the call on that panel, or null when it has none showing. */
  selHalves: SceneHalves | null
  /**
   * The box the outline traces, or null when nothing drawn is selected. An entry hidden by
   * the current layout gets none: a handle over something that is not drawn drags a
   * picture the author cannot see moving.
   */
  selectedRect: Rect | null
}

export function overlaySelection(
  api: EditorModeApi,
  panelPolys: (PanelPoly | null)[],
  natSizes: Record<string, { w: number; h: number }>,
  halvesOn: HalvesOn,
  callRoles: CallRole[] | null,
): OverlaySelection {
  const { selected, config } = api
  const selImg = selected?.kind === 'img' ? config.images[selected.index] : null
  const selBubble = selected?.kind === 'bubble' ? config.bubbles[selected.index] : null
  const selPanel = panelOfSelection(selected, selImg, selBubble)
  const selPoly = selPanel === null ? null : panelPolys[selPanel]
  const selHalves = selPanel === null ? null : halvesOn(selPanel)
  const shown = selImg ?? selBubble
  const hidden = shown !== null && !inRoles(shown.call, callRoles)
  const selectedRect =
    !selPoly || hidden ? null : entryRect(selImg, selBubble, selPoly, selHalves, natSizes)
  return { selImg, selPanel, selPoly, selHalves, selectedRect }
}
