import { useMemo } from 'react'
import type { ReactNode } from 'react'

import CallBubble from './CallBubble'
import { CALL_SCENE_ALT, CALL_SCENE_ART } from './callScene'
import { splitAcross } from './callSceneGeometry'
import type { SceneHalf } from './callSceneGeometry'
import { toClipPath } from './editor/transforms'
import { HALF_GUTTER } from './panelGeometry'
import type { PanelPoly, Rect, VpPt } from './panelGeometry'
import type { CallScene } from './phoneActions'
import { linesBy } from '../../lib/callTranscript'

interface CallHalfProps {
  half: SceneHalf
  /** The panel's box: the half is positioned inside the panel element, relative to it. */
  bounds: Rect
  src: string
  alt: string
  /** Colorized. Nothing else lights a half — not the pointer, not the panel's hover. */
  lit: boolean
  children?: ReactNode
}

/** One side of the scene: a picture windowed by the half's polygon, and whatever sits on it. */
function CallHalf({ half, bounds, src, alt, lit, children }: CallHalfProps) {
  const { box, pts } = half
  return (
    <div
      className={`cb-call-half${lit ? ' is-speaking' : ''}`}
      style={{ left: box.x - bounds.x, top: box.y - bounds.y, width: box.w, height: box.h }}
    >
      <img
        className="cb-panel-img cb-call-art"
        src={src}
        alt={alt}
        draggable={false}
        style={{ clipPath: toClipPath(pts, box.x, box.y) }}
      />
      {children}
    </div>
  )
}

/** SVG `points` for a viewport polygon, relative to the panel box. */
const pointsOf = (pts: readonly VpPt[], bounds: Rect): string =>
  pts.map(([x, y]) => `${x - bounds.x},${y - bounds.y}`).join(' ')

interface PanelCallSceneProps {
  poly: PanelPoly
  scene: CallScene
}

/**
 * What the telephone's panel shows while a call is up: itself, cut in two.
 *
 * Left is the far end — a ringing telephone until they pick up, then the man who did,
 * with a speech bubble once there are words to put in it. Right is the caller, whose
 * bubble also carries the red key that ends the call. The halves are the panel's own
 * polygon split down the middle a gutter apart (callSceneGeometry.ts) and inked like
 * two panels, so the scene reads as the page having gained a seam rather than as a
 * picture pasted over one.
 *
 * A half colorizes for exactly one reason: its speaker is talking. The panel drops its
 * hover lighting for the life of the scene (ComicPanel), because a colorized picture is
 * the one thing here that means "this voice is on the line".
 */
export default function PanelCallScene({ poly, scene }: PanelCallSceneProps) {
  const { bounds, vp } = poly
  const halves = useMemo(() => splitAcross(vp, bounds), [vp, bounds])
  const connected = scene.phase === 'connected'
  const { transcript } = scene
  const remoteSpeaking = transcript.speaking === 'remote'
  const localSpeaking = transcript.speaking === 'local'
  const gutterX = halves.cutX - HALF_GUTTER

  return (
    <>
      {/* Paper between the halves: the dots canvas under the scene is clipped to the
          whole panel, and a gutter is paper, not dots. Clipped to the panel polygon so
          it stops where the panel's ink runs. */}
      <div
        className="cb-call-gutter"
        style={{
          left: gutterX - bounds.x,
          width: HALF_GUTTER * 2,
          clipPath: toClipPath(vp, gutterX, bounds.y),
        }}
      />
      <CallHalf
        half={halves.left}
        bounds={bounds}
        src={connected ? CALL_SCENE_ART.remote : CALL_SCENE_ART.ringing}
        alt={connected ? CALL_SCENE_ALT.remote : CALL_SCENE_ALT.ringing}
        // The ringing telephone is the one thing making a sound before the pickup.
        lit={connected ? remoteSpeaking : true}
      >
        {connected && (
          <CallBubble
            lines={linesBy(transcript, 'remote')}
            speaking={remoteSpeaking}
            label="What they said"
          />
        )}
      </CallHalf>
      <CallHalf
        half={halves.right}
        bounds={bounds}
        src={CALL_SCENE_ART.local}
        alt={CALL_SCENE_ALT.local}
        lit={localSpeaking}
      >
        <CallBubble
          lines={linesBy(transcript, 'local')}
          speaking={localSpeaking}
          label="What you said"
          onEnd={scene.onEnd}
        />
      </CallHalf>
      {/* The halves' ink — one stroked polygon each, the way PanelInk strokes a panel. */}
      <svg className="cb-call-ink" viewBox={`0 0 ${bounds.w} ${bounds.h}`} aria-hidden="true">
        <polygon points={pointsOf(halves.left.pts, bounds)} />
        <polygon points={pointsOf(halves.right.pts, bounds)} />
      </svg>
    </>
  )
}
