import type { CallScenePhase } from '../phoneActions'
import type { EditorModeApi } from './useEditorMode'

// Which layout the page's calls are showing. Three positions and not a checkbox plus a
// phase: what a scene draws differs between ringing and connected — one figure or two,
// and whose words are lit — so an author framing it has to be able to stand in either.
// Session state, so the page comes back on Default.

/** The switch's three positions: the ordinary contents, and the call's two states. */
const CALL_LAYOUTS: readonly (readonly [CallScenePhase | null, string])[] = [
  [null, 'Default'],
  ['ringing', 'Ringing'],
  ['connected', 'Connected'],
]

/**
 * Nothing at all until some panel is a phone call. A switch between two layouts on a
 * page that has only one is a control with one meaningful position, and it would sit in
 * the toolbar of every ordinary page saying so.
 */
export default function CallLayoutSwitch({ api }: { api: EditorModeApi }) {
  if (api.config.callScenes.length === 0) return null

  return (
    <div className="cb-ed-modes" role="group" aria-label="Call layout">
      {CALL_LAYOUTS.map(([phase, label]) => (
        <button
          key={label}
          type="button"
          className={`cb-ed-btn${api.callPhase === phase ? ' cb-ed-btn-on' : ''}`}
          aria-pressed={api.callPhase === phase}
          onClick={() => api.setCallPhase(phase)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
