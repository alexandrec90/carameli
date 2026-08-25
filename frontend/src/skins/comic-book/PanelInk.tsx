import { imgFramePoints, isFullPanelFrame } from './editor/transforms'
import type { ImgTransform } from './editor/types'
import type { PanelPoly } from './panelGeometry'

interface PanelInkProps {
    /** Sparse, PANELS-length: null slots are panels that live on another page. */
    polys: (PanelPoly | null)[]
    images: ImgTransform[]
}

/**
 * The ink layer — every panel outline plus every inset picture frame, on one
 * viewport-level SVG that sits above the images and below the wash.
 */
export default function PanelInk({ polys, images }: PanelInkProps) {
    return (
        <svg className="cb-panel-svg" aria-hidden="true">
            {polys.map((poly, i) => poly && (
                <polygon
                    key={i}
                    points={poly.vp.map(([x, y]) => `${x},${y}`).join(' ')}
                    fill="none"
                    stroke="#111111"
                    strokeWidth="5"
                    strokeLinejoin="miter"
                />
            ))}
            {/* A picture that has been given its own frame is inked like the panel
                it sits in — that border is what makes an inset picture read as a
                panel-within-a-panel rather than as a pasted cut-out. A full-panel
                frame is skipped: its ink would land on the panel outline already
                drawn above, doubling the stroke along an identical path. */}
            {images.map((img, k) => {
                if (isFullPanelFrame(img)) return null
                const poly = polys[img.panel]
                if (!poly) return null
                const pts = imgFramePoints(poly.vp, poly.bounds, img)
                if (pts.length === 0) return null
                return (
                    <polygon
                        key={`img-${k}`}
                        points={pts.map(([x, y]) => `${x},${y}`).join(' ')}
                        fill="none"
                        stroke="#111111"
                        strokeWidth="5"
                        strokeLinejoin="miter"
                    />
                )
            })}
        </svg>
    )
}
