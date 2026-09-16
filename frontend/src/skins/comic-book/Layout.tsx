import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { LayoutProps } from '../types'
import { useSlowReady } from '../../hooks/useSlowLoading'
import { isBubbleRevealed } from './bubbleTube'
import BubbleTubes from './BubbleTubes'
import ComicPanel from './ComicPanel'
import { LoadingOverlay, useLoadingScreen } from './LoadingOverlay'
import MarginGrid from './MarginGrid'
import PanelInk from './PanelInk'
import { activeLayout, useCallLayout, useDrawnImageCount } from './layoutSource'
import { accentForPath } from './pageAccent'
import { pageForPath } from './panels'
import { softphoneActions } from './phoneActions'
import { usePanelDots } from './usePanelDots'
import { usePanelHover } from './usePanelHover'
import { shouldRevealImg, useEditorApi, useEditorMode } from './editor/editorContext'
import { useLiveTableImages } from './useLiveTableImages'
import { letteringPx, pageFrameStyle, panelPolysIn, usePageFrame } from './usePageFrame'
import { usePageWash } from './usePageWash'
import './comic-book.css'

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

// ─── Dev-only editor (lazy) ────────────────────────────────────────────────────
// Both gated on import.meta.env.DEV at module scope: in a production build this static
// `false` lets Rollup eliminate the branch and drop each chunk entirely.
//
// The overlay is the editor's *UI*. The provider is its engine, and it is the one that
// matters to what a visitor downloads: LayoutBody has to ask for editor state on every
// render — a hook cannot be called conditionally — and while it asked the engine's own
// module for it, that edge shipped 31.2 KB of mutators to everyone. It asks a context
// instead (./editor/editorContext.ts, which carries the account), and this is the only
// thing that ever fills that context in.
const EditorOverlay = import.meta.env.DEV
    ? lazy(() => import('./editor/EditorOverlay'))
    : null
const EditorProvider = import.meta.env.DEV
    ? lazy(() => import('./editor/EditorProvider'))
    : null

// ─── Layout ──────────────────────────────────────────────────────────────────

/**
 * The page, plus the dev editor above it when there is one.
 *
 * Two components rather than one because the engine has to sit *above* everything that
 * reads it, and the only way to load it conditionally is to load it late. In a production
 * build `EditorProvider` folds to null and this is `LayoutBody` with a branch in front of
 * it; in a dev session the body mounts once, after the provider resolves — `fallback` is
 * null rather than the body itself precisely so that it mounts once rather than twice.
 */
export function Layout(props: LayoutProps) {
    if (!EditorProvider) return <LayoutBody {...props} />
    return (
        <Suspense fallback={null}>
            <EditorProvider>
                <LayoutBody {...props} />
            </EditorProvider>
        </Suspense>
    )
}

// children intentionally not rendered — panels-only foundation phase. navItems
// only feeds the dev editor's page selector (no in-page nav chrome yet).
function LayoutBody({ navItems, sms, softphone }: LayoutProps) {
    const location = useLocation()
    const editor = useEditorMode()
    // Null in a build and in any test that does not mount the provider, which is what
    // keeps the mutators off the page: the overlay below is the only thing that takes it.
    const editorApi = useEditorApi()
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

    // The page frame and which of the three grids it holds: the window's shape, or the
    // one the editor is previewing. Everything on the page is a fraction of this frame
    // (./usePageFrame.ts), so it is the only thing here that knows the window's size —
    // the viewport comes back with it for the one layer drawn outside the frame.
    const { kind: layoutKind, frame, viewport } = usePageFrame(editor.shape)
    // Sparse, PANELS-length: null where the panel lives on the other page.
    const panelPolys = useMemo(
        () => panelPolysIn(grids[page][layoutKind], frame),
        [grids, page, layoutKind, frame],
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

    // A page with no pictures has no load events to wait for. `?slow=1` holds the answer
    // back for a second (dev only, no-op otherwise) — gated here rather than inside
    // useLoadingScreen so the sheet's exit wash, the page's fade-in and MarginGrid still
    // start on the same render, which is the handoff the brake exists to show.
    const ready = useSlowReady(loaded || imgCount === 0)

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

    return (
        <>
            <div
                className={`cb-root${editor.active ? ' cb-edit-active' : ''}`}
                style={{
                    opacity: ready ? 1 : 0,
                    transition: ready ? 'opacity 150ms ease-in' : 'none',
                    ...pageFrameStyle(frame),
                }}
            >
                {/* Layer 0 — the letterbox around the page sheet, carrying on the loading
                    screen's lit dot grid under the same spotlight (MarginGrid). Up only once
                    the page is showing: under the loading sheet the same grid is already drawn. */}
                <MarginGrid viewport={viewport} frame={frame} accent={accent} active={ready} />

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
                            lettering={letteringPx(frame)}
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
            {EditorOverlay && editorApi?.active && (
                <Suspense fallback={null}>
                    <EditorOverlay
                        api={editorApi}
                        panelPolys={panelPolys}
                        page={page}
                        natSizes={natSizes}
                        layoutKind={layoutKind}
                        frame={frame}
                        pageSelect={{
                            navItems,
                            pageLabels: editorApi.config.pageLabels,
                            previewingLoading: loading.previewLoading,
                            onPreviewLoading: loading.handlePreviewLoading,
                            onPageLabel: editorApi.setPageLabel,
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
