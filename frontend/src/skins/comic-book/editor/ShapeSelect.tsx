import type { LayoutKind } from '../panelGeometry'
import { LAYOUT_KINDS } from './configSeed'

// The toolbar's window-shape selector. A page has one grid per window shape and the
// frame is letterboxed at that shape's fixed aspect, so a page can be shown at any of
// the three in any window: picking one here is how an author tunes the portrait grid
// on a landscape monitor without dragging the window narrow.

/** Sentinel <option> value for following the window's own shape. */
export const FOLLOW_WINDOW_VALUE = '__window__'

/** What each shape is called in the dropdown. */
export const SHAPE_LABELS: Record<LayoutKind, string> = {
  landscape: 'Landscape (wide)',
  square: 'Square',
  portrait: 'Portrait (tall)',
}

/** The <select> value for a held shape, or for following the window. */
export function shapeSelectValue(shape: LayoutKind | null): string {
  return shape ?? FOLLOW_WINDOW_VALUE
}

/** The shape a dropdown choice means; anything unknown falls back to the window. */
export function resolveShapeSelection(value: string): LayoutKind | null {
  return (LAYOUT_KINDS as string[]).includes(value) ? (value as LayoutKind) : null
}

interface ShapeSelectProps {
  shape: LayoutKind | null
  onShape(shape: LayoutKind | null): void
}

export default function ShapeSelect({ shape, onShape }: ShapeSelectProps) {
  return (
    <label className="cb-ed-field">
      <span>Shape</span>
      <select
        className="cb-ed-select"
        value={shapeSelectValue(shape)}
        onChange={e => onShape(resolveShapeSelection(e.target.value))}
      >
        <option value={FOLLOW_WINDOW_VALUE}>Follow the window</option>
        {LAYOUT_KINDS.map(kind => (
          <option key={kind} value={kind}>
            {SHAPE_LABELS[kind]}
          </option>
        ))}
      </select>
    </label>
  )
}
