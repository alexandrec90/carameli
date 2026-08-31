import { callSceneOn } from '../callSceneRoles'
import { CALL_CUT } from './configOps'
import type { EditorModeApi } from './useEditorMode'

// The seam, on a panel that is a phone call. It belongs to the panel and not to any one
// entry: both halves are measured from it, so moving it from a picture's inspector would
// be editing every other entry's frame from inside one of them.

interface CallSeamFieldsProps {
  api: EditorModeApi
  /** The selected panel, whose seam this is — nothing is drawn for a panel with no call. */
  panel: number
}

export default function CallSeamFields({ api, panel }: CallSeamFieldsProps) {
  const scene = callSceneOn(api.config.callScenes, panel)
  if (!scene) return null

  return (
    <>
      <label className="cb-ed-field">
        <span>call seam</span>
        <input
          type="range"
          min={CALL_CUT.min}
          max={CALL_CUT.max}
          step={CALL_CUT.step}
          value={scene.cut}
          onChange={e => api.setCallScene(panel, { cut: Number(e.target.value) })}
        />
        <output>{scene.cut}%</output>
      </label>
      <label className="cb-ed-field">
        <span>call split</span>
        <select
          className="cb-ed-select"
          value={scene.axis}
          onChange={e => api.setCallScene(panel, { axis: e.target.value === 'y' ? 'y' : 'x' })}
        >
          <option value="x">Side by side</option>
          <option value="y">One above the other</option>
        </select>
      </label>
    </>
  )
}
