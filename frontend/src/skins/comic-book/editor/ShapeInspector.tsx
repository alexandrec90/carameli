import { useState } from 'react'

import type { LayoutKind, PanelGrid } from '../panelGeometry'
import { constraintOf } from '../panelGeometry'
import type { PanelPage } from '../panels'
import type { CutAxis } from './panelGridCut'
import { insertBend, moveVertex } from './panelGridOps'
import PanelNameField from './PanelNameField'
import type { EditorModeApi } from './useEditorMode'
import type { SeamDragApi } from './useSeamDrag'

// The toolbar half of the shape editor: which page and which of its three grids is in
// front, what the selected corner is and what it is allowed to do, and the edits a
// pointer cannot make — an exact coordinate, straightening a bend back out, and cutting
// a panel in two.

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
  const seam = api.selected?.kind === 'seam' ? drag.seams[api.selected.index] ?? null : null
  const panelIndex = api.selected?.kind === 'panel' ? api.selected.index : null
  const panelInfo = panelIndex === null ? null : (api.config.panels[panelIndex] ?? null)

  // Which panel the last refused cut was aimed at. Keyed by panel rather than cleared
  // on selection change so the note goes away by itself once the author moves on, with
  // no effect needed to reset it.
  const [refused, setRefused] = useState<number | null>(null)
  const split = (axis: CutAxis) => {
    if (panelIndex === null) return
    setRefused(api.splitPanel(panelIndex, axis, kind) ? null : panelIndex)
  }

  const setAxis = (axis: 0 | 1, value: string) => {
    if (index === null || !vertex) return
    const next: [number, number] = [vertex[0], vertex[1]]
    next[axis] = fromPercent(value, vertex[axis])
    api.setGridFor(page, kind, moveVertex(grid, index, next))
  }

  // The double-click gesture's reachable spelling: break the selected line at its
  // midpoint, then drag the new corner where it is wanted.
  const breakSelectedSeam = () => {
    if (!seam) return
    const a = grid.vertices[seam.a]
    const b = grid.vertices[seam.b]
    if (!a || !b) return
    const { grid: next, index: bend } = insertBend(grid, seam.a, seam.b, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2])
    api.setGridFor(page, kind, next)
    api.select('vertex', bend)
  }

  return (
    <div className="cb-ed-shape">
      <div className="cb-ed-shape-kind">
        Editing the <strong>{kind}</strong> grid — the other two keep their own shapes.
      </div>

      {panelInfo && panelIndex !== null ? (
        <>
          <div className="cb-ed-label">{panelInfo.label} panel</div>
          {/* Editable here as well as in content mode: a split selects the half it just
              made, and naming it is the next thing an author does. */}
          <PanelNameField api={api} panel={panelIndex} />
          <div className="cb-ed-hint">
            Cut it in two along a straight line through its middle. The upper or left
            half keeps this panel&apos;s name, pictures and bubbles; the other half is a new
            panel, on every window shape of this page. The new line is then a seam like
            any other — drag it, bend it, merge its corners.
          </div>
          <div className="cb-ed-row">
            <button
              type="button"
              className="cb-ed-btn"
              title="Cut a horizontal line through the middle: one panel above, one below"
              onClick={() => split('across')}
            >
              Split top / bottom
            </button>
            <button
              type="button"
              className="cb-ed-btn"
              title="Cut a vertical line through the middle: one panel left, one right"
              onClick={() => split('down')}
            >
              Split left / right
            </button>
          </div>
          {refused === panelIndex && (
            <div className="cb-ed-shape-note">
              Refused: on at least one of this page&apos;s three grids a straight cut through
              the middle would not divide this panel cleanly — its outline bends back on
              itself, or a corner sits too close to the cut. Reshape it and try again.
            </div>
          )}
        </>
      ) : !vertex || constraint === null ? (
        <>
          <div className="cb-ed-hint">
            Click a panel to cut it in two. Drag a line to move it, or a corner to move
            that end. Double-click a line to break it — repeat for a lightning bolt. Drop
            a corner onto a neighbouring one to merge the two; Alt-drag a corner to tear
            a junction back apart. The outer frame and the gutters are fixed.
          </div>
          {seam && (
            <button
              type="button"
              className="cb-ed-btn"
              title="Break this line at its midpoint, adding a corner to drag"
              onClick={breakSelectedSeam}
            >
              Add a corner to this line
            </button>
          )}
        </>
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
