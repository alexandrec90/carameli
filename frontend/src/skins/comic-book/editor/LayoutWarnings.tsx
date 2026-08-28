import type { LayoutViolation } from './configParity'
import { violationLines } from './configParity'

// What is still half-built about the working copy, listed in the toolbar beside the two
// buttons that write it out.
//
// It is here rather than left to the test suite because the author is the only person who
// can finish a balloon, and the toolbar is the one place they are standing. A violation
// found later is found by somebody else, in another tree, with no idea which of the
// balloons on screen was the one being worked on.

interface LayoutWarningsProps {
  violations: LayoutViolation[]
}

export default function LayoutWarnings({ violations }: LayoutWarningsProps) {
  if (violations.length === 0) return null
  return (
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
  )
}
