import { useCallback, useMemo } from 'react'

import { EDITOR_CALL_TRANSCRIPT } from './callScene'
import { splitAt } from './callSceneGeometry'
import { callSceneOn, halfFor, inRoles, panelRoles, rolesAtPhase } from './callSceneRoles'
import type { PanelPoly, Rect } from './panelGeometry'
import type { Panel, PanelPage } from './panels'
import { callSceneOf } from './phoneActions'
import type { CallScene, CallScenePhase } from './phoneActions'
import {
  PAGE_LABELS, PANEL_BUBBLE_CHAINS, PANEL_CALL_SCENES, PANEL_IMG_TRANSFORMS,
  PANEL_BUBBLE_TRANSFORMS, PANEL_GRIDS, PANEL_PATTERNS, PANELS,
} from './editor/layoutConfig'
import type { CallSceneLayout, EditorConfig, ImgTransform } from './editor/types'
import type { UseSoftphoneResult } from '../../hooks/useSoftphone'

// Where the page's drawn state comes from: the shipped constants, the editor's working
// copy when one is open, and — on top of either — which of a panel's two layouts is up.
// Both questions live together because a panel must never have to ask the second one for
// itself: it asks whether there is a call to draw, never whether the editor is up.

/**
 * The layout as committed to `editor/layoutConfig.ts`. Built once at module scope so its
 * identity is stable: the grids and pictures are memo dependencies in Layout, and a fresh
 * object per render would recompute every polygon on the page each frame.
 */
const SHIPPED_LAYOUT: EditorConfig = {
  pageLabels: PAGE_LABELS,
  panels: PANELS,
  images: PANEL_IMG_TRANSFORMS,
  bubbles: PANEL_BUBBLE_TRANSFORMS,
  chains: PANEL_BUBBLE_CHAINS,
  callScenes: PANEL_CALL_SCENES,
  grids: PANEL_GRIDS,
  patterns: PANEL_PATTERNS,
}

/** The editor's working copy while one is open, the shipped constants otherwise. */
export function activeLayout(editor: { active: boolean; config: EditorConfig }): EditorConfig {
  return editor.active ? editor.config : SHIPPED_LAYOUT
}

/**
 * How many of `images` are drawn on `page` right now — what the loading overlay counts its
 * settle events against.
 *
 * It must ask exactly what `PanelImages` asks before it mounts a picture, because a picture
 * that never mounts fires neither `load` nor `error`: one counted but not drawn leaves the
 * overlay waiting for a settle that cannot arrive, and the page never appears. **Two** things
 * keep a picture off the page and both belong here — a panel that lives on the other page,
 * and a call layout that is not the one on screen.
 *
 * The first was handled from the start; the second arrived with call layouts (#295) and was
 * not, so the home page counted its three call-role pictures — which mount only during a
 * call — and waited on 8 settles that could only ever reach 5.
 */
export function drawnImageCount(
  images: readonly ImgTransform[],
  panels: readonly Panel[],
  page: PanelPage,
  callScenes: readonly CallSceneLayout[],
  call: CallScene | null,
): number {
  return images.filter(t => panels[t.panel]?.page === page
    && inRoles(t.call, panelRoles(callScenes, t.panel, call))).length
}

/**
 * {@link drawnImageCount} as the layout consumes it: memoised, and behind a hook boundary
 * on purpose.
 *
 * React Compiler reads a call to an ordinary function as possibly *mutating* its arguments,
 * and `panels` is a property of the same layout object `grids` comes from. Handing it to a
 * plain helper therefore marked `grids` "modified later", which made the `panelPolys` memo
 * above it impossible to preserve and made the compiler skip the whole component — four
 * `preserve-manual-memoization` errors for a function that mutates nothing. A hook's
 * arguments are frozen, so the same call through this door states what is already true.
 * Keep the boundary even if the count moves: it is what keeps the skin's largest component
 * compiled. The memo is the second reason — a stable count keeps `markSettled` stable.
 */
export function useDrawnImageCount(
  images: readonly ImgTransform[],
  panels: readonly Panel[],
  page: PanelPage,
  callScenes: readonly CallSceneLayout[],
  call: CallScene | null,
): number {
  return useMemo(
    () => drawnImageCount(images, panels, page, callScenes, call),
    [images, panels, page, callScenes, call],
  )
}

/**
 * Where picture `t` is drawn while `phase` is up, or null when it is not drawn at all.
 *
 * The same question PanelImages answers for the drawing, asked once more because the
 * hover probe measures rectangles rather than reading the DOM (see panelHover.ts). Both
 * answers come from the one call state, so the two cannot disagree about which layout is
 * showing.
 */
function callImgBox(
  t: ImgTransform,
  bounds: Rect,
  phase: CallScenePhase | null,
  callScenes: CallSceneLayout[],
  panelPolys: (PanelPoly | null)[],
): Rect | null {
  const scene = phase === null ? undefined : callSceneOn(callScenes, t.panel)
  const poly = panelPolys[t.panel]
  const halves = scene && poly ? splitAt(poly.vp, poly.bounds, scene.cut, scene.axis) : null
  const roles = scene && phase ? rolesAtPhase(phase) : null
  if (!inRoles(t.call, roles)) return null
  return halfFor(t.call, halves)?.box ?? bounds
}

/** What the page's editor state says about the call, when it is the one deciding. */
interface CallEditorState {
  active: boolean
  callPhase: CallScenePhase | null
}

/**
 * The call every panel with a call layout draws, and the hover probe's matching frames.
 *
 * In the editor it is the author's choice of layout rather than the telephone's state,
 * carrying sample words so a transcript balloon is something you can frame.
 */
export function useCallLayout(
  editor: CallEditorState,
  softphone: UseSoftphoneResult,
  callScenes: CallSceneLayout[],
  panelPolys: (PanelPoly | null)[],
): { call: CallScene | null; imgBox: (t: ImgTransform, bounds: Rect) => Rect | null } {
  const call = editor.active
    ? editor.callPhase && { phase: editor.callPhase, transcript: EDITOR_CALL_TRANSCRIPT }
    : callSceneOf(softphone)
  const phase = call?.phase ?? null
  const imgBox = useCallback(
    (t: ImgTransform, bounds: Rect) => callImgBox(t, bounds, phase, callScenes, panelPolys),
    [phase, callScenes, panelPolys],
  )
  return { call, imgBox }
}
