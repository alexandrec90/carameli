import { DEFAULT_QUAD } from '../tableProjection'
import type { Quad } from '../tableProjection'
import Section from './Section'
import { setCorner } from './useTableCornerDrag'

interface QuadCornersProps {
  quad: Quad
  onChange(quad: Quad): void
  /** The section heading's `?`: the grips are a different colour per surface. */
  hint: string
  /** The Reset button's lettering and its tooltip, which name the surface. */
  resetLabel: string
  resetTitle: string
}

/** The quad's corners in reading order, for the coordinate fields. */
const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left']

/** A typed number, or the previous value when the field is mid-edit and unparseable. */
function numOr(value: string, fallback: number): number {
  const n = Number.parseFloat(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * The eight coordinate fields and the Reset that place a projected surface's four corners
 * exactly, folded into a section of their own.
 *
 * Both ways of placing a corner still exist on purpose. The grips over the page (see
 * TableCorners.tsx) are how the quad gets roughly onto the drawn lines; these fields are
 * how it gets exactly onto them, because a pointer cannot reliably hit a tenth of a
 * percent and the whole illusion is that the last tenth is right.
 *
 * Folded because of *when* each is used: the corners are set once, when the surface is
 * first fitted to the photograph, and everything after that is done beside them. Left
 * open they were the tallest block the inspector could put on screen, and since
 * `useToolbarColumns` turns toolbar height into toolbar width, a notepad with a table on
 * it was answering a click with a three-column panel over most of the drawing.
 *
 * One component rather than the two near-identical copies that were in TableInspector and
 * NumberPadInspector: the two surfaces differ in the colour of their grips and in nothing
 * this block does.
 */
export default function QuadCorners({
  quad, onChange, hint, resetLabel, resetTitle,
}: QuadCornersProps) {
  return (
    <Section title="corners" hint={hint}>
      {CORNERS.map((name, i) => (
        <div className="cb-ed-row" key={name}>
          <label className="cb-ed-field">
            <span>{name} X %</span>
            <input
              className="cb-ed-input"
              type="number"
              step="0.1"
              aria-label={`${name} X %`}
              value={Math.round((quad[i]?.[0] ?? 0) * 100) / 100}
              onChange={e =>
                onChange(setCorner(quad, i, numOr(e.target.value, quad[i]?.[0] ?? 0), quad[i]?.[1] ?? 0))
              }
            />
          </label>
          {/* The visible label says only "Y %" — the corner is named once, on the left of
              the row it shares — but the accessible name says which corner, or the block
              would offer four controls called the same thing. */}
          <label className="cb-ed-field">
            <span>Y %</span>
            <input
              className="cb-ed-input"
              type="number"
              step="0.1"
              aria-label={`${name} Y %`}
              value={Math.round((quad[i]?.[1] ?? 0) * 100) / 100}
              onChange={e =>
                onChange(setCorner(quad, i, quad[i]?.[0] ?? 0, numOr(e.target.value, quad[i]?.[1] ?? 0)))
              }
            />
          </label>
        </div>
      ))}

      <button
        type="button"
        className="cb-ed-btn"
        title={resetTitle}
        onClick={() => onChange(DEFAULT_QUAD.map(([x, y]) => [x, y]) as Quad)}
      >
        {resetLabel}
      </button>
    </Section>
  )
}
