import {
  imgAspect,
  imgClipStyle,
  imgFillStyle,
  imgFrameStyle,
  imgPanelClip,
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
 * sits and how big it renders. The frame draws no ink and cuts no *shape*: while `spill`
 * is off the panel crops the picture ({@link imgPanelClip}), and while it is on nothing
 * does. That is a bubble's rule, unchanged, which is the point — a picture is an entity
 * that lives on a panel, not a second copy of one.
 *
 * The frame's height is not authored: it is the width divided by the source's own
 * aspect ratio ({@link imgAspect}), so a picture is drawn whole, at its true
 * proportions, and the box the editor outlines is the picture's own edge. Nothing about
 * clicking a picture changes what is drawn.
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
  onSettled,
  onNatSize,
}: PanelImagesProps) {
  return (
    <>
      {images.map((img, i) => {
        if (img.panel !== panel) return null
        const aspect = imgAspect(natSizes[img.src])
        return (
          <div
            key={i}
            className="cb-img-clip"
            style={{
              ...imgFrameStyle(bounds, img, aspect),
              ...imgClipStyle(img.spill, imgPanelClip(vp, bounds, img, aspect)),
            }}
          >
            {/* Fills the frame exactly, because the frame was built to this source's
                ratio. Until it loads the frame is square and the picture letterboxes
                inside it — one frame, behind the loading sheet. */}
            <img
              src={img.src}
              alt={img.alt}
              className="cb-panel-img"
              loading="eager"
              draggable={false}
              style={imgFillStyle()}
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
