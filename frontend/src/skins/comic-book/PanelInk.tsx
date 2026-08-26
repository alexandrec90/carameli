import type { PanelPoly } from './panelGeometry'

/**
 * Exported so a test can assert this is the *whole* prop surface: `polys` and nothing
 * else. A picture cannot be inked by a layer that is never handed one, and that is a
 * stronger guarantee than counting what got drawn — see PanelInk.test.tsx.
 */
export interface PanelInkProps {
    /** Sparse, PANELS-length: null slots are panels that live on another page. */
    polys: (PanelPoly | null)[]
}

/**
 * The ink layer — one stroked outline per panel, on a viewport-level SVG that sits
 * above the images and below the wash.
 *
 * **Only panels are inked.** A picture used to get a border of its own here, drawn on
 * the panel's polygon scaled into the picture's frame, on the theory that an inset
 * picture reads as a panel-within-a-panel. It does not: a picture is a picture, its
 * real edges are its own artwork's, and a second black polygon in the panel's shape
 * around a frame that is not the panel is the thing the editor's selection outline
 * kept contradicting. Frames and panels are independent — this layer draws panels.
 */
export default function PanelInk({ polys }: PanelInkProps) {
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
        </svg>
    )
}
