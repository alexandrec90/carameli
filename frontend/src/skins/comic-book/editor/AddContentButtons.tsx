import type { EditorModeApi } from './useEditorMode'

// The three things that can be added to a panel. One row, one shape of button, because
// the differences between them are entirely in what they drop on the page — and writing
// them out three times was three copies of the same disabled/title/guard ternary.

interface Adder {
  label: string
  /** How the button's tooltip names what it adds: "Add {what} to Notepad". */
  what: string
  add(api: EditorModeApi, panel: number): void
}

const ADDERS: Adder[] = [
  { label: '+ Image', what: 'a picture', add: (api, panel) => api.addImgOn(panel) },
  { label: '+ Bubble', what: 'a bubble', add: (api, panel) => api.addBubbleOn(panel) },
  // A conversation is not "a bubble, twice": it is two balloons that have to be linked,
  // chained, given the right content and bound, in that order, and any one of those undone
  // by an ordinary edit takes it apart. So it is its own button, and the author is never
  // asked to assemble it.
  { label: '+ SMS', what: 'an SMS conversation', add: (api, panel) => api.addSmsOn(panel) },
]

interface AddContentButtonsProps {
  api: EditorModeApi
  /**
   * The panel a new picture or bubble would go on, or null. New content lands on the
   * selection because there is no other answer to "which panel" that does not need a
   * second click — so with nothing selected the whole row is held.
   */
  selPanel: number | null
}

export default function AddContentButtons({ api, selPanel }: AddContentButtonsProps) {
  const panelName =
    selPanel === null ? '' : api.config.panels[selPanel]?.label ?? `panel ${selPanel}`

  return (
    <div className="cb-ed-actions">
      {ADDERS.map(adder => (
        <button
          key={adder.label}
          type="button"
          className="cb-ed-btn"
          disabled={selPanel === null}
          title={
            selPanel === null ? 'Select a panel first' : `Add ${adder.what} to ${panelName}`
          }
          onClick={() => {
            if (selPanel !== null) adder.add(api, selPanel)
          }}
        >
          {adder.label}
        </button>
      ))}
    </div>
  )
}
