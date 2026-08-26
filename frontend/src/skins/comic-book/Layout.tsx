import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import type { LayoutProps } from '../types'
import { isBubbleRevealed } from './bubbleTube'
import BubbleTubes from './BubbleTubes'
import ComicPanel from './ComicPanel'
import { LoadingOverlay, useLoadingScreen } from './LoadingOverlay'
import PanelInk from './PanelInk'
import { gridPolys, layoutKindFor } from './panelGeometry'
import { PANEL_BG_CONFIGS, drawPanelBackground } from './panelPatterns'
import { PANELS, pageForPath } from './panels'
import {
    PANEL_BUBBLE_CHAINS, PANEL_IMG_TRANSFORMS, PANEL_BUBBLE_TRANSFORMS,
    PANEL_GRIDS, PANEL_PATTERNS,
} from './editor/layoutConfig'
import { shouldRevealImg, useEditorMode } from './editor/useEditorMode'
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
// A panel is a slot in the grid and nothing more: its label, whether it is the logo,
// where it navigates and which *page* it belongs to live in PANELS (./panels.ts),
// index-parallel to the rings of every grid in PANEL_GRIDS. Each page's grid keeps a
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
export function Layout({ navItems }: LayoutProps) {
    const location = useLocation()
    const editor = useEditorMode()
    const page = pageForPath(location.pathname)

    // Source transforms from the editor's working copy when active, else constants.
    const imgT = editor.active ? editor.config.images : PANEL_IMG_TRANSFORMS
    const bubbleT = editor.active ? editor.config.bubbles : PANEL_BUBBLE_TRANSFORMS
    const chainT = editor.active ? editor.config.chains : PANEL_BUBBLE_CHAINS
    const grids = editor.active ? editor.config.grids : PANEL_GRIDS
    const patterns = editor.active ? editor.config.patterns : PANEL_PATTERNS
    // The dot loop is a useCallback([]) that outlives any one render; it reads the
    // current patterns through this ref so an editor pattern change repaints on the
    // next frame instead of being trapped in a stale closure. Written from an effect
    // (never during render) — commit lands before the next rAF frame, which is the
    // earliest the loop can look.
    const patternsRef = useRef(patterns)
    useEffect(() => {
        patternsRef.current = patterns
    }, [patterns])

    const panelDotRefs = useRef<(HTMLCanvasElement | null)[]>([])
    const rafRef = useRef<number>(0)
    const settledCountRef = useRef(0)

    // The viewport, not the polygons. The shapes are *derived* from it, the page and
    // the grid just below, which is what lets a drag in the shape editor repaint
    // immediately: holding computed polygons in state meant nothing but a resize
    // could change them.
    const [viewport, setViewport] = useState<{ w: number; h: number }>(() =>
        typeof window === 'undefined'
            ? { w: 0, h: 0 }
            : { w: window.innerWidth, h: window.innerHeight }
    )
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
    // and needs the same answer, which CSS cannot hand it.
    const [hovered, setHovered] = useState<number | null>(null)
    const bubbleVisible = (i: number): boolean =>
        isBubbleRevealed(bubbleT, hovered, editor.active, i)

    // One tick per picture element that has loaded or failed. Counted against the
    // number of pictures actually on *this page* — a picture on the other page never
    // mounts, so it never settles, and counting it would hold the loader up forever.
    const imgCount = imgT.filter(t => PANELS[t.panel]?.page === page).length
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

    const accent = accentForPath(location.pathname)
    const washRef = usePageWash(location.pathname, accent)
    const loading = useLoadingScreen(ready, accent)

    // ── Ben-Day dot animation loop ────────────────────────────────────────────
    const animatePanelDots = useCallback(() => {
        const t = performance.now() / 1000
        for (let i = 0; i < PANELS.length; i++) {
            const canvas = panelDotRefs.current[i]
            if (!canvas) continue
            const ctx = canvas.getContext('2d')
            if (!ctx) continue
            const ow = canvas.offsetWidth
            const oh = canvas.offsetHeight
            if (ow > 0 && oh > 0 && (canvas.width !== ow || canvas.height !== oh)) {
                canvas.width = ow
                canvas.height = oh
            }
            if (canvas.width === 0 || canvas.height === 0) continue
            drawPanelBackground(
                ctx, canvas.width, canvas.height,
                patternsRef.current[i] ?? PANEL_PATTERNS[i], PANEL_BG_CONFIGS[i], t,
            )
        }
        rafRef.current = requestAnimationFrame(animatePanelDots)
    }, [])

    // ── Resize handler — record the viewport; the polygons follow ─────────────
    const handleResize = useCallback(() => {
        const w = window.innerWidth
        const h = window.innerHeight
        setViewport(prev => (prev.w === w && prev.h === h ? prev : { w, h }))
    }, [])

    useLayoutEffect(() => { handleResize() }, [handleResize])

    useEffect(() => {
        window.addEventListener('resize', handleResize)
        rafRef.current = requestAnimationFrame(animatePanelDots)
        return () => {
            window.removeEventListener('resize', handleResize)
            cancelAnimationFrame(rafRef.current)
        }
    }, [handleResize, animatePanelDots])

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
                    const info = PANELS[i]
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
                            natSizes={natSizes}
                            editorActive={editor.active}
                            hovered={hovered === i}
                            onHover={over =>
                                setHovered(prev => (over ? i : prev === i ? null : prev))
                            }
                            isRevealed={k => shouldRevealImg(editor.active, editor.selected, k)}
                            isBubbleVisible={bubbleVisible}
                            dotRef={el => { panelDotRefs.current[i] = el }}
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
                            previewingLoading: loading.previewLoading,
                            onPreviewLoading: loading.handlePreviewLoading,
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
