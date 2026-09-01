import type { ConfigDrift } from './configDrift'
import type { LayoutViolation } from './configParity'
import { violationLines } from './configParity'
import StaleNotice from './StaleNotice'

import './editor-warnings.css'

// What is still half-built about the working copy, listed in the toolbar beside the two
// buttons that write it out.
//
// It is here rather than left to the test suite because the author is the only person who
// can finish a balloon, and the toolbar is the one place they are standing. A violation
// found later is found by somebody else, in another tree, with no idea which of the
// balloons on screen was the one being worked on.
//
// The staleness line above them is a different kind of thing — not about this layout at
// all, but about the file it would be written to — and it is here for the same reason:
// the only moment it matters is the moment before Save is pressed, and this is what is
// under the button. See ./configStamp.ts for how it is known.

interface LayoutWarningsProps {
  violations: LayoutViolation[]
  /** True when Save would overwrite a `layoutConfig.ts` this working copy never saw. */
  stale: boolean
  /** What that file gained, per panel, or null when this copy cannot say. */
  drift: ConfigDrift | null
  /** True for a copy carrying no record of the file it came from. */
  untracked: boolean
  onAdopt(panel: number): void
}

export default function LayoutWarnings({
  violations, stale, drift, untracked, onAdopt,
}: LayoutWarningsProps) {
  if (violations.length === 0 && !stale && !untracked) return null
  return (
    <>
      <StaleNotice stale={stale} drift={drift} untracked={untracked} onAdopt={onAdopt} />
      {violations.length > 0 && (
        <div className="cb-ed-unfinished" role="status" aria-label="Unfinished layout">
          <p className="cb-ed-unfinished-head">
            {violations.length === 1 ? '1 thing is' : `${violations.length} things are`} unfinished.
            Save still writes the file; Ship waits for these.
          </p>
          <ul className="cb-ed-unfinished-list">
            {violationLines(violations).map(line => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
