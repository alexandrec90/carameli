import type { Rect } from '../panelGeometry'
import type { ProjectedSurface } from './types'
import type { EditorModeApi } from './useEditorMode'
import { useSurfaceCornerDrag } from './useTableCornerDrag'
import './editor-table.css'

interface TableCornersProps {
  api: EditorModeApi
  /** Index of the picture the surface belongs to, into `api.config.images`. */
  index: number
  surface: ProjectedSurface
  kind: 'table' | 'numberPad'
  /** The picture's frame in viewport px — the box the quad's percentages measure. */
  rect: Rect
}

/** Which corner is which, for the grip tooltips and for anyone reading the quad. */
const CORNER_NAMES = ['top-left', 'top-right', 'bottom-right', 'bottom-left']

/**
 * The four grips that tilt a projected surface, drawn over the picture that carries it.
 *
 * They sit outside the surface itself rather than on it, because the surface is under a
 * `matrix3d`: a handle drawn inside would be projected too, so the one at the far corner
 * would be the smallest and hardest to hit exactly where the alignment matters most.
 * These are plain viewport-space squares of a constant size, joined by an outline that
 * *is* the quad — drag a grip onto the corner of the ruled area in the photograph and the
 * rows follow.
 */
export default function SurfaceCorners({ api, index, surface, kind, rect }: TableCornersProps) {
  const drag = useSurfaceCornerDrag(api, index, surface, rect, kind)
  const points = drag.corners.map(([x, y]) => `${x},${y}`).join(' ')
  const label = kind === 'table' ? 'table' : 'number pad'
  const variant = kind === 'table' ? 'table' : 'number-pad'

  return (
    <>
      <svg className={`cb-ed-quad cb-ed-quad-${variant}`} aria-hidden="true">
        <polygon points={points} />
      </svg>
      {drag.corners.map(([x, y], i) => (
        <div
          key={i}
          className={`cb-ed-handle cb-ed-quad-grip cb-ed-quad-grip-${variant}`}
          style={{ left: x - 7, top: y - 7 }}
          title={`Drag the ${CORNER_NAMES[i]} corner of the ${label} onto the surface`}
          onPointerDown={e => drag.onCornerDown(e, i)}
          onPointerMove={drag.onPointerMove}
          onPointerUp={drag.onPointerUp}
        />
      ))}
    </>
  )
}
