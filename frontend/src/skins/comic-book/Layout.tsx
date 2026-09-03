import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { LayoutProps } from '../types'
import { isBubbleRevealed } from './bubbleTube'
import BubbleTubes from './BubbleTubes'
import ComicPanel from './ComicPanel'
import { LoadingOverlay, useLoadingScreen } from './LoadingOverlay'
import PanelInk from './PanelInk'
import { gridPolys, layoutKindFor } from './panelGeometry'
import { activeLayout, useCallLayout, useDrawnImageCount } from './layoutSource'
import { pageForPath } from './panels'
import { softphoneActions } from './phoneActions'
import { usePanelDots } from './usePanelDots'
import { usePanelHover } from './usePanelHover'
import { shouldRevealImg, useEditorMode } from './editor/useEditorMode'
import { useLiveTableImages } from './useLiveTableImages'
import { usePageWash } from './usePageWash'
import './comic-book.css'
import './bubbles.css'
import './bubbleChains.css'

// ─── Page-accent map ─────────────────────────────────────────────────────────

const PAGE_ACCENT: Record<string, string> = {
    '/': '#FFE033',
    '/phone-lines': '#0057B8',
    '/extensions': '#E8003D',
}

function accentForPath(path: string): string {
    return PAGE_ACCENT[path] ?? '#00AEEF'
}

// ─── Panel contents ─────────────────────────────────────────────────────────
// A panel is a slot in the grid and nothing more: its label, whether it is the logo
// and which *page* it belongs to live in PANELS (editor/layoutConfig.ts, typed by
// ./panels.ts), index-parallel to the rings of every grid in PANEL_GRIDS — the editor
// appends to both together when a panel is split. Each page's grid keeps a
// ring for every panel, with an empty ring where the panel sits on the other page —
// gridPolys hands those back with no vertices, and the sparse map below turns them
// into null slots so nothing renders for them here.
//
// What is *drawn* in a panel is not parallel to anything. Pictures come from
// PANEL_IMG_TRANSFORMS and bubbles from PANEL_BUBBLE_TRANSFORMS (both in
// editor/layoutConfig.ts, the source of truth); each entry names the `panel` it sits
// on, so a panel may own several or none, and PanelImages.tsx / PanelBubbles.tsx
// filter. The one array that IS parallel to PANELS is PANEL_PATTERNS (same file):
// entry `i` names the Ben-Day background style drawn behind panel `i`, with its
// colors and dot metrics tuned in PANEL_BG_CONFIGS (./panelPatterns.ts).

// ─── Dev-only editor overlay (lazy) ────────────────────────────────────────────
// Gated on import.meta.env.DEV at module scope: in a production build this static
// `false` lets Rollup eliminate the branch and drop the overlay's chunk entirely.
const EditorOverlay = import.meta.env.DEV
    ? lazy(() => import('./editor/EditorOverlay'))
    : null

// ─── Layout ──────────────────────────────────────────────────────────────────

// children intentionally not rendered — panels-only foundation phase. navItems
// only feeds the dev editor's page selector (no in-page nav chrome yet).
export function Layout({ navItems, sms, softphone }: LayoutProps) {
    const location = useLocation()
    const editor = useEditorMode()
    const page = pageForPath(location.pathname)

    // Everything drawn comes from the editor's working copy when one is open, else from
    // the shipped constants (./layoutSource.ts).
    const layout = activeLayout(editor)
    const { bubbles: bubbleT, chains: chainT, callScenes: callSceneT, grids, patterns, panels } =
        layout
    // A picture whose surface names a live feed gets its cells from the records rather
    // than from the config. Applied here, between the working copy and the panels, so the
    // editor keeps holding — and saving — the authored surface with no rows in it.
    const imgT = useLiveTableImages(layout.images)

    const settledCountRef = useRef(0)

    // The viewport, not the polygons. The shapes are *derived* from it, the page and
    // the grid just below, which is what lets a drag in the shape editor repaint
    // immediately: holding computed polygons in state meant nothing but a resize
    // could change them.
    const [viewport, setViewport] = useState<{ w: number; h: number }>(() =>
        typeof window === 'undefined' ? { w: 0, h: 0 } : { w: window.innerWidth, h: window.innerHeight })
    const layoutKind = layoutKindFor(viewport.w, viewport.h)
    // Sparse, PANELS-length: a panel on the other page has an empty ring in this
    // page's grid, which gridPolys returns as a vertex-less polygon — mapped to null
    // here so every consumer can tell "not on this page" from a real shape.
    const panelPolys = useMemo(
        () => (viewport.w > 0 && viewport.h > 0
            ? gridPolys(grids[page][layoutKind], viewport.w, viewport.h)
                .map(p => (p.vp.length >= 3 ? p : null))
            : []),
        [grids, page, layoutKind, viewport.w, viewport.h],
    )
    // Natural (intrinsic) pixel size of each loaded source, captured on load and keyed
    // by `src`. Drives fullImgStyle (the real framing); absent until the img loads,
    // during which the equivalent object-fit:contain fallback renders. Keyed by source
    // rather than by index because two pictures may be the same file, and the second
    // should not have to wait for its own load to learn a size already known.
    const [natSizes, setNatSizes] = useState<Record<string, { w: number; h: number }>>({})
    // True once every panel image has loaded or errored.
    const [loaded, setLoaded] = useState(false)

    // Which panel the pointer is over, or null. Bubble reveal moved off CSS :hover
    // and into state because the tube layer is a viewport-level sibling of the panels
    // and needs the same answer, which CSS cannot hand it — and off the panel elements
    // entirely, because those are overlapping bounding rectangles and the browser's
    // hit-testing answered for the rectangles, not the polygons (see panelHover.ts).
    // The call every panel with a call layout draws (or null for none, which is what puts
    // those panels back on their ordinary contents), and the frames the hover probe must
    // measure while it is up. Both from useCallLayout, so the two cannot disagree about
    // which layout is showing.
    const { call, imgBox } = useCallLayout(editor, softphone, callSceneT, panelPolys)
    const hovered = usePanelHover(panelPolys, imgT, natSizes, imgBox)
    const bubbleVisible = (i: number): boolean =>
        isBubbleRevealed(bubbleT, hovered, editor.active, i)

    // One tick per picture element that has loaded or failed. Counted against the pictures
    // actually *drawn* — one the renderer skips never mounts, so it never settles, and
    // counting it would hold the loader up forever (drawnImageCount owns both reasons).
    const imgCount = useDrawnImageCount(imgT, panels, page, callSceneT, call)
    const markSettled = useCallback(() => {
        settledCountRef.current += 1
        if (settledCountRef.current >= imgCount) setLoaded(true)
    }, [imgCount])

    // A page with no pictures has no load events to wait for.
    const ready = loaded || imgCount === 0

    /** Remember a source's natural size the first time it loads. */
    const recordNatSize = useCallback((src: string, size: { w: number; h: number }) => {
        setNatSizes(prev => (prev[src] ? prev : { ...prev, [src]: size }))
    }, [])

    // Enter in a `phone` balloon places the call. The balloon holds the number in its own
    // field rather than in `dialTarget`, so it is handed over here; the promise is the
    // call being set up, and anything that goes wrong with it surfaces through `error`.
    const { autoDial } = softphone
    const dialFromBubble = useCallback((value: string) => {
        void autoDial(value)
    }, [autoDial])

    // The two keys of the drawn telephone. Rebuilt every render on purpose rather than
    // memoised: what each key means moves with the call (`phoneActions.ts`), so a cached
    // pair would be the previous state's handset for one frame after the phone rang.
    const phoneActions = softphoneActions(softphone)
    const accent = accentForPath(location.pathname)
    const washRef = usePageWash(location.pathname, accent)
    const loading = useLoadingScreen(ready, accent)

    // ── Ben-Day dot canvases ──────────────────────────────────────────────────
    // One rAF loop for every panel, but only the hovered panel's pattern moves —
    // the rest hold the frame they froze on. See usePanelDots / panelDotAnim.
    const dotRefs = usePanelDots(patterns, hovered)

    // ── Resize handler — record the viewport; the polygons follow ─────────────
    const handleResize = useCallback(() => {
        const w = window.innerWidth
        const h = window.innerHeight
        setViewport(prev => (prev.w === w && prev.h === h ? prev : { w, h }))
    }, [])

    useLayoutEffect(() => { handleResize() }, [handleResize])

    useEffect(() => {
        window.addEventListener('resize', handleResize)
        return () => { window.removeEventListener('resize', handleResize) }
    }, [handleResize])

    return (
        <>
            <div
                className={`cb-root${editor.active ? ' cb-edit-active' : ''}`}
                style={{ opacity: ready ? 1 : 0, transition: ready ? 'opacity 150ms ease-in' : 'none' }}
            >
                {/* Layer 1 — the panels (ComicPanel: dots, pictures, bubbles). The poly
                    array is sparse: a null slot is a panel on the other page. */}
                {panelPolys.map((poly, i) => {
                    if (!poly) return null
                    const info = panels[i]
                    if (!info) return null
                    return (
                        <ComicPanel
                            key={i}
                            index={i}
                            info={info}
                            poly={poly}
                            images={imgT}
                            bubbles={bubbleT}
                            chains={chainT}
                            callScenes={callSceneT}
                            sms={sms}
                            natSizes={natSizes}
                            editorActive={editor.active}
                            hovered={hovered === i}
                            isRevealed={k => shouldRevealImg(editor.active, editor.selected, k)}
                            isBubbleVisible={bubbleVisible}
                            onNumberPadKey={softphone.pressDigit}
                            onPhoneSubmit={dialFromBubble}
                            phoneActions={phoneActions}
                            call={call}
                            dotRef={dotRefs[i]}
                            onSettled={markSettled}
                            onNatSize={recordNatSize}
                        />
                    )
                })}

                {/* Connector tubes between linked bubbles — one viewport-level layer, because
                    a bubble spills past its panel and the corridor joining two of them runs
                    through the gutter. Painted above the bubbles so each tube welds into
                    both mouths. */}
                <BubbleTubes polys={panelPolys} bubbles={bubbleT} isVisible={bubbleVisible} />

                {/* Layer 2 — Panel outline SVG (sits above images, below the wash) */}
                <PanelInk polys={panelPolys} />

                {/* Layer 3 — Ben-Day wash canvas (page transitions; blank when idle) */}
                <canvas ref={washRef} className="cb-wash-canvas" aria-hidden="true" />

            </div>

            {/* Dev-only editor overlay — never reached in a production build */}
            {EditorOverlay && editor.active && (
                <Suspense fallback={null}>
                    <EditorOverlay
                        api={editor}
                        panelPolys={panelPolys}
                        page={page}
                        natSizes={natSizes}
                        layoutKind={layoutKind}
                        viewport={viewport}
                        pageSelect={{
                            navItems,
                            pageLabels: editor.config.pageLabels,
                            previewingLoading: loading.previewLoading,
                            onPreviewLoading: loading.handlePreviewLoading,
                            onPageLabel: editor.setPageLabel,
                        }}
                    />
                </Suspense>
            )}

            {/* Loading indicator — outside cb-root so it's visible while the page is
                opacity:0. Stays mounted through the leave wash (see LoadingOverlay). */}
            <LoadingOverlay screen={loading} />
        </>
    )
}
