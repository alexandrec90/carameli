import { CALL_ROLE_LABELS, CALL_ROLES, isCallRole } from '../callSceneRoles'
import type { SelectionKind } from './selection'
import type { CallRole } from './types'
import type { EditorModeApi } from './useEditorMode'

// Which layer of the panel an entry belongs to, and — if it is the call's — which half
// it is framed against. It sits above the kind-specific fields in the inspector because
// it is the one that decides when the rest of them are even on screen: an entry with a
// role is invisible on the default layout, and one without is invisible on the call.
// Choosing a role therefore switches the page to the layout the entry has just joined,
// or nothing appears to have happened.

interface CallRoleFieldProps {
  api: EditorModeApi
  /** Which array the selected entry is in — the two are patched by different mutators. */
  kind: SelectionKind
  index: number
  /** The role the entry carries now; absent for one that is not part of a call. */
  value: CallRole | undefined
}

export default function CallRoleField({ api, kind, index, value }: CallRoleFieldProps) {
  const choose = (raw: string) => {
    const call: CallRole | undefined = isCallRole(raw) ? raw : undefined
    if (kind === 'img') api.setImg(index, { call })
    else api.setBubble(index, { call })
    if (call === undefined) api.setCallPhase(null)
    else if (api.callPhase === null) api.setCallPhase(call === 'ringing' ? 'ringing' : 'connected')
  }

  return (
    <label className="cb-ed-field">
      <span>call role</span>
      <select
        className="cb-ed-select"
        value={value ?? ''}
        onChange={e => choose(e.target.value)}
      >
        <option value="">Not part of a call</option>
        {CALL_ROLES.map(role => (
          <option key={role} value={role}>{CALL_ROLE_LABELS[role]}</option>
        ))}
      </select>
    </label>
  )
}
