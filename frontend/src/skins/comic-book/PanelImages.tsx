import {
  fullImgStyle,
  imgClipStyle,
  imgFrameBox,
  imgFrameStyle,
  imgPanelClip,
  imgTransformStyle,
  surfaceBaseRect,
} from './editor/transforms'
import type { ImgTransform } from './editor/types'
import ProjectedNumberPad from './ProjectedNumberPad'
import ProjectedTable from './ProjectedTable'

interface PanelImagesProps {
  /** Every picture on the page — `panel` decides which ones this panel draws. */
  images: ImgTransform[]
  /** Index of the panel being drawn, into PANELS. */
  panel: number
  /** Box of the panel being drawn, in viewport coords. */
  bounds: { x: number; y: number; w: number; h: number }
  /** The panel's polygon in viewport coords — the window every picture is seen through. */
  vp: [number, number][]
  /** Natural pixel size of each loaded source, keyed by `src`; missing until it loads. */
  natSizes: Record<string, { w: number; h: number }>
  /** Whether picture `index` (into `images`) is revealed — editor selection. */
  isRevealed(index: number): boolean
  /** Editor active: projected content draws alignment guides and takes no pointer input. */
  editing: boolean
  /** Makes every projected number pad on this panel a working keypad. */
  onNumberPadKey?: (key: string) => void
  /** Called once per picture element when it has loaded or failed. */
  onSettled(): void
  /** Called with a source's natural size the first time it loads. */
  onNatSize(src: string, size: { w: number; h: number }): void
}

/**
 * The pictures belonging to one panel. A panel may own several or none — the array is
 * filtered by `panel` rather than indexed by it, so adding a picture in the editor is
 * an append and never has to line up with anything.
 *
 * Each picture has its own frame over the panel box ({@link imgFrameStyle}) and is seen
 * through the panel's own polygon ({@link imgPanelClip}) — a rectangle of picture,
 * bounded by its frame and cut only where the panel's ink runs. A picture is not a
 * panel: it gets no border of its own and its frame is never restyled into the grid's
 * slanted shape.
 *
 * Natural sizes are keyed by `src` rather than by index: two pictures on the same panel
 * may well be the same file, and keying by index would make the second one wait for its
 * own load to learn a size the first already knew.
 */
export default function PanelImages({
  images,
  panel,
  bounds,
  vp,
  natSizes,
  isRevealed,
  editing,
  onNumberPadKey,
  onSettled,
  onNatSize,
}: PanelImagesProps) {
  return (
    <>
      {images.map((img, i) => {
        if (img.panel !== panel) return null
        const frame = imgFrameBox(bounds, img)
        const nat = natSizes[img.src]
        const reveal = isRevealed(i)
        // The box a projected surface's quad measures: the picture's rendered rect in
        // the wrapper's own coordinates (the wrapper sits at the frame, so the frame's
        // origin is 0,0 here). Based on the artwork rather than the frame so the
        // surface stays on the photograph when a resize re-letterboxes the frame.
        const base = surfaceBaseRect({ x: 0, y: 0, w: frame.w, h: frame.h }, nat, img)
        return (
          <div
            key={i}
            className="cb-img-clip"
            style={{
              ...imgFrameStyle(bounds, img),
              ...imgClipStyle(img.spill, reveal, imgPanelClip(vp, bounds, img)),
            }}
          >
            {/* Full-source geometry once the natural size is known, so pan/zoom
                re-frames the picture under the clip instead of moving a pre-cropped
                box; the identical contain-fit fallback renders until then. */}
            <img
              src={img.src}
              alt={img.alt}
              className="cb-panel-img"
              loading="eager"
              draggable={false}
              style={
                nat
                  ? fullImgStyle(frame, nat, img)
                  : {
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      width: frame.w,
                      height: frame.h,
                      ...imgTransformStyle(img),
                    }
              }
              onLoad={e => {
                const el = e.currentTarget
                onNatSize(img.src, { w: el.naturalWidth, h: el.naturalHeight })
                onSettled()
              }}
              onError={e => {
                const el = e.currentTarget
                console.warn('[comic-book] Failed to load panel image:', el.src)
                el.style.display = 'none'
                onSettled()
              }}
            />
            {/* Projected content sits inside the frame wrapper on purpose — clipped by
                the same polygon, so moving or resizing the picture carries the content
                along — and is measured against the picture's rendered rect, not the
                wrapper, so it also stays on the photograph when the frame's aspect
                ratio changes and the contain-fit re-letterboxes. */}
            {img.table && (
              <ProjectedTable table={img.table} base={base} editing={editing} />
            )}
            {img.numberPad && (
              <ProjectedNumberPad
                numberPad={img.numberPad}
                base={base}
                editing={editing}
                onKey={onNumberPadKey}
              />
            )}
          </div>
        )
      })}
    </>
  )
}
