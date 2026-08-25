import { useNavigate } from 'react-router-dom'
import type { BubbleChain } from './bubbleChain'
import PanelBubbles from './PanelBubbles'
import PanelImages from './PanelImages'
import { toClipPath } from './editor/transforms'
import type { BubbleTransform, ImgTransform } from './editor/types'
import type { PanelPoly } from './panelGeometry'
import type { Panel } from './panels'

interface ComicPanelProps {
    /** This panel's index into PANELS — what pictures and bubbles name. */
    index: number
    info: Panel
    poly: PanelPoly
    /** Every picture on the page; this panel renders the ones that name it. */
    images: ImgTransform[]
    /** Every bubble on the page; this panel renders the ones that name it. */
    bubbles: BubbleTransform[]
    /** Per-chain behavior for the chain names carried by bubbles. */
    chains: BubbleChain[]
    natSizes: Record<string, { w: number; h: number }>
    editorActive: boolean
    hovered: boolean
    onHover(over: boolean): void
    /** True when picture `k` (index into `images`) is the editor's full-reveal selection. */
    isRevealed(k: number): boolean
    isBubbleVisible(i: number): boolean
    /** Mounts the Ben-Day dot canvas into Layout's animation loop. */
    dotRef(el: HTMLCanvasElement | null): void
    onSettled(): void
    onNatSize(src: string, size: { w: number; h: number }): void
}

/**
 * One panel of the grid: the Ben-Day dot canvas, the pictures and the bubbles that
 * name this slot, absolutely positioned at the polygon Layout computed for it.
 * overflow stays visible so pictures and bubbles can spill into the gutters.
 */
export default function ComicPanel({
    index, info, poly, images, bubbles, chains, natSizes,
    editorActive, hovered, onHover, isRevealed, isBubbleVisible,
    dotRef, onSettled, onNatSize,
}: ComicPanelProps) {
    const navigate = useNavigate()
    const { bounds, vp } = poly

    // The dots clip tightly to the panel polygon (element-relative px coords). A
    // picture clips to its own frame instead — the same shape scaled into it —
    // which PanelImages works out per picture.
    const dotClip = toClipPath(vp, bounds.x, bounds.y)

    // While editing, the selected picture reveals its full self (clip off) so the
    // whole of it stays visible for framing; the outline SVG still draws the crop
    // shape on top. The panel is lifted whenever any of its pictures is the
    // revealed one.
    const revealFull = images.some((img, k) => img.panel === index && isRevealed(k))

    return (
        <div
            className={[
                'cb-panel',
                info.isLogo ? 'logo' : '',
                info.path ? 'clickable' : '',
                revealFull ? 'cb-panel-reveal' : '',
                // Lift the panel over the ink-line SVG while its bubbles show,
                // so they are not crossed by frame ink.
                !editorActive && hovered ? 'cb-panel-lift' : '',
            ].filter(Boolean).join(' ')}
            role={info.path ? 'button' : undefined}
            tabIndex={info.path ? 0 : undefined}
            style={{
                position: 'absolute',
                left: bounds.x,
                top: bounds.y,
                width: bounds.w,
                height: bounds.h,
                overflow: 'visible',
            }}
            onMouseEnter={() => onHover(true)}
            onMouseLeave={() => onHover(false)}
            onClick={() => info.path && navigate(info.path)}
            onKeyDown={e => {
                if ((e.key === 'Enter' || e.key === ' ') && info.path) {
                    e.preventDefault()
                    navigate(info.path)
                }
            }}
        >
            {/* Ben-Day dots — clipped to tight panel polygon */}
            <canvas
                ref={dotRef}
                className="cb-dots-panel-canvas"
                style={{ clipPath: dotClip }}
            />
            {/* Pictures — however many name this panel, each on its own frame over
                the panel box, each cut to the panel's shape scaled into that frame.
                `spill` (and the editor's full-reveal selection) drops the clip so a
                picture pops out over the frame lines. */}
            <PanelImages
                images={images}
                panel={index}
                bounds={bounds}
                vp={vp}
                natSizes={natSizes}
                isRevealed={isRevealed}
                editing={editorActive}
                onSettled={onSettled}
                onNatSize={onNatSize}
            />
            {/* Speech bubbles — generated vector outlines (PanelBubble), however
                many name this panel. Revealed while this panel is hovered, or
                always in edit mode. */}
            <PanelBubbles
                bubbles={bubbles}
                chains={chains}
                panel={index}
                clip={dotClip}
                isVisible={isBubbleVisible}
                interactive={!editorActive}
                editing={editorActive}
            />
        </div>
    )
}
