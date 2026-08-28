import { PANEL_ASSETS } from './assets'
import NumberPadInspector from './NumberPadInspector'
import TableInspector from './TableInspector'
import type { ImgTransform } from './types'
import type { EditorModeApi } from './useEditorMode'

interface ImageInspectorProps {
  api: EditorModeApi
  /** Index of the selected picture, into `api.config.images`. */
  index: number
  /** The selected picture itself. */
  image: ImgTransform
}

/**
 * The nine CSS `object-position` keyword pairs. The anchor decides which part of the
 * picture survives when its aspect ratio does not match the frame's — 'center bottom'
 * is what keeps a character's feet in shot in a wide panel.
 */
const ANCHORS = [
  'left top', 'center top', 'right top',
  'left center', 'center center', 'right center',
  'left bottom', 'center bottom', 'right bottom',
]

/**
 * The picture-only half of the selection inspector: which panel it sits on, which file
 * it draws, its alt text, and its frame.
 *
 * The frame is the part that is new. A picture used to borrow its panel's polygon as
 * its window, so there was nothing here to edit and dragging could only slide the
 * picture underneath. Now the frame is the picture's own rectangle over the panel box
 * and a panel can hold as many as the author wants.
 *
 * TableInspector then hangs off the bottom of it: any picture may be turned into a
 * surface with a table projected onto it, which is a property of the picture rather than
 * of the panel it sits on.
 */
export default function ImageInspector({ api, index, image }: ImageInspectorProps) {
  const set = (patch: Partial<ImgTransform>) => api.setImg(index, patch)

  return (
    <>
      <label className="cb-ed-field">
        <span>panel</span>
        <select
          className="cb-ed-select"
          value={image.panel}
          onChange={e => set({ panel: Number(e.target.value) })}
        >
          {api.config.panels.map((p, i) => (
            <option key={i} value={i}>{p.label}</option>
          ))}
        </select>
      </label>
      <label className="cb-ed-field">
        <span>picture</span>
        <select
          className="cb-ed-select"
          value={image.src}
          onChange={e => set({ src: e.target.value })}
        >
          {/* A src the manifest does not know (hand-edited config) still has to be
              selectable, or opening the dropdown would silently rewrite it. */}
          {!PANEL_ASSETS.some(a => a.src === image.src) && (
            <option value={image.src}>{image.src}</option>
          )}
          {PANEL_ASSETS.map(a => (
            <option key={a.src} value={a.src}>{a.label}</option>
          ))}
        </select>
      </label>
      <label className="cb-ed-field">
        <span>alt</span>
        <input
          className="cb-ed-input"
          type="text"
          value={image.alt}
          placeholder="(decorative)"
          onChange={e => set({ alt: e.target.value })}
        />
      </label>
      <label className="cb-ed-field">
        <span>anchor</span>
        <select
          className="cb-ed-select"
          value={image.anchor}
          onChange={e => set({ anchor: e.target.value })}
        >
          {!ANCHORS.includes(image.anchor) && <option value={image.anchor}>{image.anchor}</option>}
          {ANCHORS.map(a => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </label>
      <TableInspector api={api} index={index} image={image} />
      <NumberPadInspector api={api} index={index} image={image} />
    </>
  )
}
