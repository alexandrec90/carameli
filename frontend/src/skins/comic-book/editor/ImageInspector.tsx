import { PANELS } from '../panels'
import { PANEL_ASSETS } from './assets'
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
 * The picture-only half of the selection inspector: which panel it sits on, which file
 * it draws, its alt text, and its frame.
 *
 * The frame is the part that is new. A picture used to borrow its panel's polygon as
 * its window, so there was nothing here to edit and dragging could only slide the
 * picture underneath. Now the frame is the picture's own rectangle over the panel box
 * and a panel can hold as many as the author wants.
 *
 * There is no anchor field, because there is nothing left to anchor: a frame is built
 * to its source's ratio, so the whole picture is always in shot and no part of it has
 * to be chosen over another.
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
          {PANELS.map((p, i) => (
            <option key={p.label} value={i}>{p.label}</option>
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
    </>
  )
}
