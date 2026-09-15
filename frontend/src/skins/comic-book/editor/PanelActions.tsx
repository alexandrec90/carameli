import { useState } from 'react'

import type { LayoutKind } from '../panelGeometry'
import { hiddenOn } from './configPanelsRemove'
import Hint from './Hint'
import type { CutAxis } from './panelGridCut'
import type { EditorModeApi } from './useEditorMode'

// What can be done to a panel as a *slot*: cut it in two, take it off one window shape,
// bring a hidden one back beside it, delete it. One component rendered by both
// inspectors — the split buttons lived in shapes mode alone and were read as gone by an
// author looking at a selected panel in content mode, which is the mode a panel is
// selected in most of the time. A panel's actions belong wherever a panel is selected.

interface PanelActionsProps {
  api: EditorModeApi
  panel: number
  /** The grid on screen — the one a hide or a show acts on, and the one a split holds still. */
  kind: LayoutKind
}

const SPLIT_HINT =
  'Cut this panel in two along a straight line through its middle. The upper or left half '
  + 'keeps this panel’s name, pictures and bubbles; the other half is a new panel, on '
  + 'every window shape of this page. The new line is then a seam like any other — drag '
  + 'it, bend it, merge its corners.'

const HIDE_HINT =
  'A page has three grids, one per window shape, and a panel can be on some and not '
  + 'others. Hide gives this panel’s space to its neighbour on the shape on screen only; '
  + 'its pictures and bubbles stay on it and show again where it is still drawn. A hidden '
  + 'panel comes back as half of a panel you select, from the list below. Delete takes it '
  + 'off every shape and out of the list, pictures and bubbles with it.'

/** Which action was refused, keyed to the panel it was aimed at, so the note clears itself on selection change. */
interface Refusal {
  panel: number
  text: string
}

const REFUSED = {
  split:
    'Refused: on at least one of this page’s three grids a straight cut through the middle '
    + 'would not divide this panel cleanly — its outline bends back on itself, or a corner '
    + 'sits too close to the cut. Reshape it and try again.',
  hide:
    'Refused: no neighbour can take this panel’s space on this shape — it is the only '
    + 'panel here, or the two outlines touch in two separate places. Reshape it and try again.',
  show:
    'Refused: a straight cut through the middle of the selected panel would not divide it '
    + 'cleanly on this shape. Reshape it and try again.',
  delete:
    'Refused: on at least one of this page’s three grids no neighbour can take this panel’s '
    + 'space. Hide it there first, or reshape it, and try again.',
}

export default function PanelActions({ api, panel, kind }: PanelActionsProps) {
  const info = api.config.panels[panel]
  const [refused, setRefused] = useState<Refusal | null>(null)
  if (!info) return null

  const hidden = hiddenOn(api.config, info.page, kind)
  const labelOf = (i: number) => api.config.panels[i]?.label ?? `panel ${i}`
  const attempt = (ok: boolean, text: string) => setRefused(ok ? null : { panel, text })

  const split = (axis: CutAxis) => attempt(api.splitPanel(panel, axis, kind), REFUSED.split)
  const hide = () => attempt(api.hidePanelOn(panel, kind), REFUSED.hide)
  const show = (which: number, axis: CutAxis) =>
    attempt(api.showPanelOn(which, kind, panel, axis), REFUSED.show)
  const remove = () => attempt(api.deletePanel(panel, kind), REFUSED.delete)

  return (
    <>
      <div className="cb-ed-row cb-ed-row-wrap">
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
      <div className="cb-ed-row cb-ed-row-wrap">
        <button
          type="button"
          className="cb-ed-btn"
          title={`Take this panel off the ${kind} shape only; its neighbour takes the space`}
          onClick={hide}
        >
          Hide on {kind}
        </button>
        <button
          type="button"
          className="cb-ed-btn cb-ed-btn-danger"
          title="Delete this panel from every shape, its pictures and bubbles with it"
          onClick={remove}
        >
          Delete panel
        </button>
        {/* One badge for every row here, on the row with room for it. */}
        <Hint text={`${SPLIT_HINT} ${HIDE_HINT}`} />
      </div>
      {hidden.map(which => (
        <div key={which} className="cb-ed-row cb-ed-row-wrap">
          <button
            type="button"
            className="cb-ed-btn"
            title={`Cut ${labelOf(panel)} through the middle and make its lower half ${labelOf(which)}`}
            onClick={() => show(which, 'across')}
          >
            Show {labelOf(which)} below
          </button>
          <button
            type="button"
            className="cb-ed-btn"
            title={`Cut ${labelOf(panel)} through the middle and make its right half ${labelOf(which)}`}
            onClick={() => show(which, 'down')}
          >
            Show {labelOf(which)} beside
          </button>
        </div>
      ))}
      {refused?.panel === panel && <div className="cb-ed-shape-note">{refused.text}</div>}
    </>
  )
}
