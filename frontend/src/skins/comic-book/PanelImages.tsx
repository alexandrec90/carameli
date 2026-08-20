import {
  fullImgStyle,
  imgClipStyle,
  imgFrameBox,
  imgFrameStyle,
  imgPanelClip,
  imgTransformStyle,
} from './editor/transforms'
import type { ImgTransform } from './editor/types'

interface PanelImagesProps {
  /** Every picture on the page — `panel` decides which ones this panel draws. */
  images: ImgTransform[]
  /** Index of the panel being drawn, into PANELS. */
  panel: number
  /** Box of the panel being drawn, in viewport coords. */
  bounds: { x: number; y: number; w: number; h: number }
  /** The panel's polygon in viewport coords — the shape a non-spilling picture is cut to. */
  vp: [number, number][]
  /** Natural pixel size of each loaded source, keyed by `src`; missing until it loads. */
  natSizes: Record<string, { w: number; h: number }>
  /** Whether picture `index` (into `images`) is revealed — editor selection. */
  isRevealed(index: number): boolean
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
 * Each picture has its own frame over the panel box ({@link imgFrameStyle}) — where it
 * sits and how big it renders, and nothing more. The frame draws no ink and cuts no
 * shape: while `spill` is off the *panel* crops the picture ({@link imgPanelClip}), and
 * while it is on nothing does. That is a bubble's rule, unchanged, which is the point —
 * a picture is an entity that lives on a panel, not a second copy of one.
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
                box; the identical cover-fit fallback renders until then. */}
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
          </div>
        )
      })}
    </>
  )
}
