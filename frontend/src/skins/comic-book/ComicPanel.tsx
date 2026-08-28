import { useCallback, useMemo, useState } from 'react'

import type { BubbleChain } from './bubbleChain'
import { dialBubbleOn } from './bubbleContent'
import { addDialled, appendDialKey } from './dialPicker'
import PanelBubbles from './PanelBubbles'
import PanelImages from './PanelImages'
import { browserCountry, formatPhoneInput } from './phoneInput'
import { splitOptions } from './wheelPicker'
import { toClipPath } from './editor/transforms'
import type { BubbleTransform, ImgTransform } from './editor/types'
import type { PanelPoly } from './panelGeometry'
import type { Panel } from './panels'
import type { PhoneActionHandlers } from './phoneActions'
import type { UseSmsConversationsResult } from '../../hooks/useSmsConversations'

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
    /** Passed straight to PanelBubbles, which is where a chain binds to a real thread. */
    sms: UseSmsConversationsResult
    natSizes: Record<string, { w: number; h: number }>
    editorActive: boolean
    /**
     * True while Layout's geometric hit test (usePanelHover) says the pointer is on
     * this panel. Hover is decided there, not here: this element is the polygon's
     * bounding rectangle, and neighbouring rectangles overlap where a seam slants.
     */
    hovered: boolean
    /** True when picture `k` (index into `images`) is the editor's full-reveal selection. */
    isRevealed(k: number): boolean
    isBubbleVisible(i: number): boolean
    /**
     * Makes a number pad projected onto one of this panel's pictures a working keypad.
     * A panel holding a `dial` balloon takes its own keys instead — see below.
     */
    onNumberPadKey?(key: string): void
    /**
     * Dials the number typed into one of this panel's `phone` balloons. On a panel that
     * holds a `dial` the call goes out through the same prop, after the number has been
     * added to that balloon's shortlist — see below.
     */
    onPhoneSubmit?(value: string): void
    /** Makes the call/end-call keys of this panel's `actions` balloons a working handset. */
    phoneActions?: PhoneActionHandlers
    /** Mounts the Ben-Day dot canvas into Layout's animation loop. */
    dotRef(el: HTMLCanvasElement | null): void
    onSettled(): void
    onNatSize(src: string, size: { w: number; h: number }): void
}

/**
 * One panel of the grid: the Ben-Day dot canvas, the pictures and the bubbles that
 * name this slot, absolutely positioned at the polygon Layout computed for it.
 * overflow stays visible so pictures and bubbles can spill into the gutters.
 *
 * **It is also where the panel's dialled number lives**, and that is a placement rather
 * than a convenience: a `dial` balloon is edited from two places at once — its own field,
 * and the number pad projected onto a picture in the same panel — and this is the only
 * component that can see both. The keys come up through PanelImages and the value goes
 * down through PanelBubbles, so neither half has to know the other exists.
 */
export default function ComicPanel({
    index, info, poly, images, bubbles, chains, sms, natSizes,
    editorActive, hovered, isRevealed, isBubbleVisible, onNumberPadKey,
    onPhoneSubmit, phoneActions, dotRef, onSettled, onNatSize,
}: ComicPanelProps) {
    const { bounds, vp } = poly

    // The dots clip tightly to the panel polygon (element-relative px coords). A
    // picture is windowed by that same polygon, offset into its own frame — which
    // PanelImages works out per picture.
    const dotClip = toClipPath(vp, bounds.x, bounds.y)

    // While editing, the selected picture reveals its full self (clip off) so the
    // whole of it stays visible for framing. The panel is lifted whenever any of its
    // pictures is the revealed one.
    const revealFull = images.some((img, k) => img.panel === index && isRevealed(k))

    const country = useMemo(() => browserCountry(), [])
    // This panel's dial balloon, and the number it starts on: its first option, the way a
    // wheel starts on its first row. Empty on a panel with no dial, which is most of them.
    const dialIndex = dialBubbleOn(bubbles, index)
    const dialSeed = dialIndex >= 0 ? splitOptions(bubbles[dialIndex].text)[0] ?? '' : ''
    const [dialValue, setDialValue] = useState(() => formatPhoneInput(dialSeed, country))
    // Whether that number is the drum's rather than the reader's — seeded, turned to, or
    // just dialled. A fresh number is finished: the next key, from the keyboard or the
    // projected pad, starts a new number instead of appending to it. Held here beside
    // the value because the pad writes through this component and never sees the
    // balloon's own state.
    const [dialFresh, setDialFresh] = useState(() => dialSeed !== '')
    // Re-seeded only when the author's own text changes — which is what makes the editor
    // show what was just typed, and what keeps a reader who cleared the field looking at
    // an empty one instead of watching it refill itself.
    //
    // Adjusted during render rather than from an effect: an effect would letter the old
    // number for one frame and then replace it, and React's own guidance is that state
    // derived from a changed input is corrected here. The re-render is immediate and
    // nothing below it has run yet, so the panel never commits the stale value.
    const [seeded, setSeeded] = useState(dialSeed)
    if (seeded !== dialSeed) {
        setSeeded(dialSeed)
        setDialValue(formatPhoneInput(dialSeed, country))
        setDialFresh(dialSeed !== '')
    }
    const onDialChange = useCallback((next: string, fresh: boolean) => {
        setDialValue(next)
        setDialFresh(fresh)
    }, [])
    // A press on the projected keypad types into the dialled number exactly as the
    // keyboard does: appended to a number the reader was already typing, but starting a
    // new number over one the drum supplied. Only on a panel that has a dial: everywhere
    // else the pad keeps going wherever it went before, and `undefined` still means the
    // keys are dead.
    const onDialPadKey = useCallback(
        (key: string) => {
            setDialValue(current => appendDialKey(dialFresh ? '' : current, key, country))
            setDialFresh(false)
        },
        [country, dialFresh],
    )
    // Numbers actually dialled from this panel, which join the dial's shortlist so the
    // drum becomes a redial list: a number reached once by typing it out or by punching
    // it into the picture is a row to turn to from then on. Held here for the same reason
    // the value is — it is the panel's number, however many balloons show it — and reset
    // when the page unmounts, which is what a comic panel's memory is worth.
    const [dialled, setDialled] = useState<string[]>([])
    const onDialSubmit = useCallback(
        (value: string) => {
            setDialled(current => addDialled(current, value))
            // The dialled number stays on the display, finished — the next key starts a
            // new call rather than growing a number that has already been placed.
            setDialFresh(true)
            onPhoneSubmit?.(value)
        },
        [onPhoneSubmit],
    )

    return (
        <div
            // The index, readable from the DOM, is what lets usePanelHover measure
            // this panel's drawn balloons — a chain's rows stand where no transform
            // says they do, so the hit test asks the elements.
            data-cb-panel={index}
            className={[
                'cb-panel',
                info.isLogo ? 'logo' : '',
                revealFull ? 'cb-panel-reveal' : '',
                // Lift the panel over the ink-line SVG while its bubbles show,
                // so they are not crossed by frame ink.
                !editorActive && hovered ? 'cb-panel-lift' : '',
                // Colorize (dots and pictures — see comic-book.css). A class rather
                // than :hover: the elements are overlapping bounding rectangles, so
                // CSS :hover lights whichever one stacks higher, not the panel the
                // geometric hit test says the pointer is on.
                hovered ? 'cb-panel-hot' : '',
            ].filter(Boolean).join(' ')}
            style={{
                position: 'absolute',
                left: bounds.x,
                top: bounds.y,
                width: bounds.w,
                height: bounds.h,
                overflow: 'visible',
            }}
        >
            {/* Ben-Day dots — clipped to tight panel polygon */}
            <canvas
                ref={dotRef}
                className="cb-dots-panel-canvas"
                style={{ clipPath: dotClip }}
            />
            {/* Pictures — however many name this panel, each on its own rectangular
                frame over the panel box, each seen through the panel's polygon.
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
                onNumberPadKey={dialIndex >= 0 ? onDialPadKey : onNumberPadKey}
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
                sms={sms}
                onPhoneSubmit={dialIndex >= 0 ? onDialSubmit : onPhoneSubmit}
                dialValue={dialValue}
                dialFresh={dialFresh}
                dialled={dialled}
                onDialChange={onDialChange}
                phoneActions={phoneActions}
            />
        </div>
    )
}
