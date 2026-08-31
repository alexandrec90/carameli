import { callSceneOn } from '../callSceneRoles'
import type { EditorModeApi } from './useEditorMode'

// The four things that can be added to a panel. One row, one shape of button, because
// the differences between them are entirely in what they drop on the page — and writing
// them out four times was four copies of the same disabled/title/guard ternary.

interface Adder {
  label: string
  /** How the button's tooltip names what it adds: "Add {what} to Notepad". */
  what: string
  add(api: EditorModeApi, panel: number): void
  /**
   * Why this adder cannot be used on `panel`, or null when it can — shown as the
   * tooltip and holding the button. Only the call answers with anything: a panel is a
   * phone call once, so the button that makes one goes dead on a panel that is.
   */
  held?(api: EditorModeApi, panel: number): string | null
}

const ADDERS: Adder[] = [
  { label: '+ Image', what: 'a picture', add: (api, panel) => api.addImgOn(panel) },
  { label: '+ Bubble', what: 'a bubble', add: (api, panel) => api.addBubbleOn(panel) },
  // A conversation is not "a bubble, twice": it is two balloons that have to be linked,
  // chained, given the right content and bound, in that order, and any one of those undone
  // by an ordinary edit takes it apart. So it is its own button, and the author is never
  // asked to assemble it.
  { label: '+ SMS', what: 'an SMS conversation', add: (api, panel) => api.addSmsOn(panel) },
  // A phone call is the same argument again, one size up: three figures, two transcripts
  // and a key to hang up with, each framed against a half of a panel that does not exist
  // until one of them says it does.
  {
    label: '+ Call',
    what: 'a phone call',
    add: (api, panel) => api.addCallOn(panel),
    held: (api, panel) =>
      callSceneOn(api.config.callScenes, panel) === undefined
        ? null
        : 'This panel is already a phone call',
  },
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
      {ADDERS.map(adder => {
        const held = selPanel === null ? null : adder.held?.(api, selPanel) ?? null
        return (
          <button
            key={adder.label}
            type="button"
            className="cb-ed-btn"
            disabled={selPanel === null || held !== null}
            title={
              selPanel === null
                ? 'Select a panel first'
                : held ?? `Add ${adder.what} to ${panelName}`
            }
            onClick={() => {
              if (selPanel !== null && held === null) adder.add(api, selPanel)
            }}
          >
            {adder.label}
          </button>
        )
      })}
    </div>
  )
}
