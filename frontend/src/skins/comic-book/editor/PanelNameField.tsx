import type { EditorModeApi } from './useEditorMode'

// A panel's name, editable wherever a panel is what is selected — which is both halves of
// the editor, not one. ./InspectorPanel.tsx has offered it in content mode since the names
// became editable; ./ShapeInspector.tsx printed the same name as static text, so the one
// moment an author most wants to type a name — straight after a split, which selects the
// new half, in shapes mode, where splitting is the only thing to do — was the one moment
// there was no field to type it into.
//
// One component rather than two copies, so the control cannot drift apart between the two
// modes and so `panel name` means one thing to a test.

interface PanelNameFieldProps {
  api: EditorModeApi
  /** Index of the selected panel, into the config's panel list. */
  panel: number
}

export default function PanelNameField({ api, panel }: PanelNameFieldProps) {
  return (
    <label className="cb-ed-field">
      <span>panel name</span>
      <input
        type="text"
        value={api.config.panels[panel]?.label ?? ''}
        onChange={e => api.setPanelLabel(panel, e.target.value)}
      />
    </label>
  )
}
