import { useState } from 'react'
import type { ReactNode } from 'react'

import Hint from './Hint'

interface SectionProps {
  /** The heading, and the button's accessible name — so it has to read as one thing. */
  title: string
  /** The paragraph that used to sit under this block, as the heading's `?`. */
  hint?: string
  /** Whether it starts open. Closed is the default: a section is here because it is big. */
  defaultOpen?: boolean
  children: ReactNode
}

/**
 * A foldable block of the inspector — the corner coordinates, the cell text, the drag
 * read-out.
 *
 * These are the parts an author sets once and then works *beside*: four corners are
 * dragged onto the ruled lines and left there, a column list is pasted in and left there.
 * They were costing the toolbar their full height for the whole session, and because
 * `useToolbarColumns` turns height into width, that height was being paid for in screen
 * area — a notepad with a table on it put a three-column panel over most of the page.
 *
 * A `<button>` and a conditional render rather than `<details>`/`<summary>`: happy-dom
 * does not implement the disclosure behaviour, so a `<details>` here would be a control
 * the editor's control-surface and reachability sweeps could see but never open, and the
 * blocks below it would be untestable through the toolbar. The caret is drawn from
 * `aria-expanded` in CSS, which keeps it out of `textContent` — that is what those sweeps
 * read a button's name from.
 *
 * Open state is ordinary component state, deliberately not remembered across mounts. It
 * survives everything an author does while working (selecting another picture re-renders
 * the inspector, it does not remount it), and a fresh mount is a fresh toolbar — which is
 * also what keeps the reachability sweep's one-mount-per-control walk honest.
 */
export default function Section({ title, hint, defaultOpen = false, children }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="cb-ed-section">
      <div className="cb-ed-section-head">
        <button
          type="button"
          className="cb-ed-section-toggle"
          aria-expanded={open}
          onClick={() => setOpen(o => !o)}
        >
          {title}
        </button>
        {hint !== undefined && <Hint text={hint} />}
      </div>
      {open && <div className="cb-ed-section-body">{children}</div>}
    </div>
  )
}
