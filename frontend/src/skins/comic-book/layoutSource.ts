import { useCallback } from 'react'

import { EDITOR_CALL_TRANSCRIPT } from './callScene'
import { splitAt } from './callSceneGeometry'
import { callSceneOn, halfFor, inRoles, rolesAtPhase } from './callSceneRoles'
import type { PanelPoly, Rect } from './panelGeometry'
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
