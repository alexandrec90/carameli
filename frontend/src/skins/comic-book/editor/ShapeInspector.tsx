import type { LayoutKind, PanelGrid } from '../panelGeometry'
import { constraintOf } from '../panelGeometry'
import type { PanelPage } from '../panels'
import { moveVertex } from './panelGridOps'
import type { EditorModeApi } from './useEditorMode'
import type { SeamDragApi } from './useSeamDrag'

// The toolbar half of the shape editor: which page and which of its three grids is in
// front, what the selected corner is and what it is allowed to do, and the two edits a
// pointer cannot make — an exact coordinate, and straightening a bend back out.

interface ShapeInspectorProps {
  api: EditorModeApi
  page: PanelPage
  kind: LayoutKind
  grid: PanelGrid
  drag: SeamDragApi
}

const CONSTRAINT_TEXT: Record<string, string> = {
  free: 'interior — moves freely',
  top: 'on the top frame edge — slides sideways',
  bottom: 'on the bottom frame edge — slides sideways',
  left: 'on the left frame edge — slides up and down',
  right: 'on the right frame edge — slides up and down',
  locked: 'frame corner — fixed',
}

/** A percentage typed into a field, back as a 0..1 fraction; NaN falls back to `fallback`. */
function fromPercent(value: string, fallback: number): number {
  const n = Number.parseFloat(value)
  return Number.isFinite(n) ? n / 100 : fallback
}

export default function ShapeInspector({ api, page, kind, grid, drag }: ShapeInspectorProps) {
  const index = drag.selectedVertex
  const vertex = index === null ? null : grid.vertices[index]
  const constraint = vertex ? constraintOf(vertex) : null

  const setAxis = (axis: 0 | 1, value: string) => {
    if (index === null || !vertex) return
    const next: [number, number] = [vertex[0], vertex[1]]
    next[axis] = fromPercent(value, vertex[axis])
    api.setGridFor(page, kind, moveVertex(grid, index, next))
  }

  return (
    <div className="cb-ed-shape">
      <div className="cb-ed-shape-kind">
        Editing the <strong>{kind}</strong> grid — the other two keep their own shapes.
      </div>

      {!vertex || constraint === null ? (
        <div className="cb-ed-hint">
          Drag a line to move it, or a corner to move that end. Double-click a line to
          break it — repeat for a lightning bolt. The outer frame and the gutters are fixed.
        </div>
      ) : (
        <>
          <div className="cb-ed-shape-note">{CONSTRAINT_TEXT[constraint]}</div>
          <div className="cb-ed-row">
            <label className="cb-ed-field">
              <span>X %</span>
              <input
                type="number"
                step="0.1"
                value={(vertex[0] * 100).toFixed(2)}
                disabled={constraint === 'locked' || constraint === 'left' || constraint === 'right'}
                onChange={e => setAxis(0, e.target.value)}
              />
            </label>
            <label className="cb-ed-field">
              <span>Y %</span>
              <input
                type="number"
                step="0.1"
                value={(vertex[1] * 100).toFixed(2)}
                disabled={constraint === 'locked' || constraint === 'top' || constraint === 'bottom'}
                onChange={e => setAxis(1, e.target.value)}
              />
            </label>
          </div>
          <button
            type="button"
            className="cb-ed-btn"
            disabled={!drag.canDeleteSelected}
            title={
              drag.canDeleteSelected
                ? 'Straighten this bend out (Delete)'
                : 'Only a bend can be removed — this corner is a junction or sits on the frame'
            }
            onClick={drag.deleteSelected}
          >
            Straighten bend
          </button>
        </>
      )}

      <button
        type="button"
        className="cb-ed-btn"
        title={`Restore the ${page} page's ${kind} panel shapes to the shipped defaults`}
        onClick={() => api.resetGridFor(page, kind)}
      >
        Reset {kind} shapes
      </button>
    </div>
  )
}
