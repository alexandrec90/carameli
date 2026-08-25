import { DEFAULT_QUAD } from '../tableProjection'
import type { Quad } from '../tableProjection'
import { FONT_SCALE } from '../tableData'
import { newNumberPad } from './numberPadValidate'
import type { ImgTransform, NumberPadProjection } from './types'
import type { EditorModeApi } from './useEditorMode'
import { setCorner } from './useTableCornerDrag'

interface NumberPadInspectorProps {
  api: EditorModeApi
  index: number
  image: ImgTransform
}

const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left']

function numOr(value: string, fallback: number): number {
  const number = Number.parseFloat(value)
  return Number.isFinite(number) ? number : fallback
}

/** Editor controls for a fixed three-by-four telephone number pad on a picture. */
export default function NumberPadInspector({ api, index, image }: NumberPadInspectorProps) {
  const numberPad = image.numberPad

  const setNumberPad = (patch: Partial<NumberPadProjection>) => {
    if (!numberPad) return
    api.setImg(index, { numberPad: { ...numberPad, ...patch } })
  }

  const toggle = (on: boolean) => {
    api.setImg(index, {
      table: on ? undefined : image.table,
      numberPad: on ? newNumberPad() : undefined,
    })
  }

  return (
    <>
      <label className="cb-ed-check">
        <input
          type="checkbox"
          checked={!!numberPad}
          onChange={event => toggle(event.target.checked)}
        />
        <span>Project a number pad on this picture</span>
      </label>

      {numberPad && (
        <>
          <div className="cb-ed-row">
            <label className="cb-ed-field">
              <span>text</span>
              <input
                type="range"
                min={FONT_SCALE.min}
                max={FONT_SCALE.max}
                step={FONT_SCALE.step}
                value={numberPad.fontScale}
                onChange={event =>
                  setNumberPad({ fontScale: numOr(event.target.value, numberPad.fontScale) })
                }
              />
            </label>
            <label className="cb-ed-field">
              <span>ink</span>
              <input
                type="color"
                value={numberPad.ink}
                onChange={event => setNumberPad({ ink: event.target.value })}
              />
            </label>
          </div>

          {CORNERS.map((name, corner) => (
            <div className="cb-ed-row" key={name}>
              <label className="cb-ed-field">
                <span>{name} X %</span>
                <input
                  className="cb-ed-input"
                  type="number"
                  step="0.1"
                  value={Math.round((numberPad.quad[corner]?.[0] ?? 0) * 100) / 100}
                  onChange={event =>
                    setNumberPad({
                      quad: setCorner(
                        numberPad.quad,
                        corner,
                        numOr(event.target.value, numberPad.quad[corner]?.[0] ?? 0),
                        numberPad.quad[corner]?.[1] ?? 0,
                      ),
                    })
                  }
                />
              </label>
              <label className="cb-ed-field">
                <span>Y %</span>
                <input
                  className="cb-ed-input"
                  type="number"
                  step="0.1"
                  value={Math.round((numberPad.quad[corner]?.[1] ?? 0) * 100) / 100}
                  onChange={event =>
                    setNumberPad({
                      quad: setCorner(
                        numberPad.quad,
                        corner,
                        numberPad.quad[corner]?.[0] ?? 0,
                        numOr(event.target.value, numberPad.quad[corner]?.[1] ?? 0),
                      ),
                    })
                  }
                />
              </label>
            </div>
          ))}

          <button
            type="button"
            className="cb-ed-btn"
            title="Put the four number-pad corners back on the picture, square"
            onClick={() =>
              setNumberPad({ quad: DEFAULT_QUAD.map(([x, y]) => [x, y]) as Quad })
            }
          >
            Reset number-pad corners
          </button>

          <div className="cb-ed-hint">
            Drag the magenta grips onto the keypad surface. Its three-by-four grid is an
            alignment guide in the editor; readers see only the keys.
          </div>
        </>
      )}
    </>
  )
}
