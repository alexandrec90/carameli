import type { PanelGrid, Rect } from '../panelGeometry'
import { constraintOf, toViewport } from '../panelGeometry'
import type { SeamDragApi } from './useSeamDrag'
import { SEAM_HIT_PX } from './useSeamDrag'

// The shape editor's drawing surface: every line the author may move, and every corner
// they may move it by. The outer frame is conspicuously absent — `seamsOf` only returns
// edges two panels share, so a frame edge simply has no handle to grab, which is how
// "the outer frame is always the same" is enforced rather than merely asked for.

interface PanelSeamsProps {
  grid: PanelGrid
  frame: Rect
  drag: SeamDragApi
}

/** A frame vertex slides along its edge; a corner does not move; the rest are free. */
function vertexClass(grid: PanelGrid, index: number, selected: boolean, snap: boolean): string {
  const constraint = constraintOf(grid.vertices[index] ?? [0, 0])
  return [
    'cb-ed-vx',
    constraint === 'locked' ? 'cb-ed-vx-locked' : constraint === 'free' ? 'cb-ed-vx-free' : 'cb-ed-vx-edge',
    selected ? 'cb-ed-vx-sel' : '',
    snap ? 'cb-ed-vx-snap' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function vertexTitle(grid: PanelGrid, index: number): string {
  switch (constraintOf(grid.vertices[index] ?? [0, 0])) {
    case 'locked':
      return 'Frame corner — fixed'
    case 'free':
      return 'Drag to move this corner; Alt-drag tears its junction apart; Delete straightens a bend'
    default:
      return 'Drag to slide this corner along the frame edge; Alt-drag tears its junction apart'
  }
}

export default function PanelSeams({ grid, frame, drag }: PanelSeamsProps) {
  return (
    <svg className="cb-ed-seams" aria-hidden="true">
      {/* Two passes per seam: a fat invisible one to be grabbed by, a thin visible one to
          be seen. One stroke cannot be both — a line drawn as thick as it needs to be
          clickable would sit nowhere near the gutter it represents. */}
      {drag.seams.map(seam => {
        const key = `${seam.a}:${seam.b}`
        const line = { x1: seam.from[0], y1: seam.from[1], x2: seam.to[0], y2: seam.to[1] }
        return (
          <g key={key}>
            <line {...line} className="cb-ed-seam" />
            <line
              {...line}
              className="cb-ed-seam-hit"
              strokeWidth={SEAM_HIT_PX * 2}
              onPointerDown={e => drag.onSeamDown(e, seam)}
              onPointerMove={drag.onPointerMove}
              onPointerUp={drag.onPointerUp}
              onDoubleClick={e => drag.onSeamDoubleClick(e, seam)}
            >
              <title>Drag to move this line; double-click to break it</title>
            </line>
          </g>
        )
      })}

      {grid.vertices.map((v, i) => {
        const [x, y] = toViewport(v, frame)
        const locked = constraintOf(v) === 'locked'
        return (
          <circle
            key={i}
            cx={x}
            cy={y}
            r={locked ? 4 : 6}
            className={vertexClass(grid, i, drag.selectedVertex === i, drag.snapVertex === i)}
            onPointerDown={locked ? undefined : e => drag.onVertexDown(e, i)}
            onPointerMove={locked ? undefined : drag.onPointerMove}
            onPointerUp={locked ? undefined : drag.onPointerUp}
          >
            <title>{vertexTitle(grid, i)}</title>
          </circle>
        )
      })}
    </svg>
  )
}
