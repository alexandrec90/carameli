import { useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, RefObject } from 'react'

import { logger } from '../../../lib/logger'
import { clamp } from './transforms'

/** localStorage key for the toolbar's dragged position (viewport px, top-left). */
const POS_KEY = 'comic-book:editToolbarPos'

/**
 * Minimum toolbar extent (px) assumed when re-clamping a persisted position on
 * load: keeps at least a grabbable corner on-screen if the window shrank since
 * the position was saved. During a live drag the real box size is used instead.
 */
const MIN_VISIBLE = 40

/** Toolbar top-left corner in viewport px. `null` = never dragged (CSS dock). */
export interface ToolbarPos {
  x: number
  y: number
}

interface Size {
  w: number
  h: number
}

/** Clamp a toolbar top-left so a `size` box stays fully inside the viewport. */
export function clampToolbarPos(pos: ToolbarPos, size: Size, viewport: Size): ToolbarPos {
  return {
    x: clamp(pos.x, 0, Math.max(0, viewport.w - size.w)),
    y: clamp(pos.y, 0, Math.max(0, viewport.h - size.h)),
  }
}

/**
 * Parse a persisted toolbar position. Returns `null` (= default docked corner)
 * for null, malformed JSON, or non-finite coordinates — never throws.
 */
export function hydrateToolbarPos(raw: string | null): ToolbarPos | null {
  if (raw == null) return null
  try {
    const p = JSON.parse(raw) as { x?: unknown; y?: unknown } | null
    if (
      p &&
      typeof p.x === 'number' && Number.isFinite(p.x) &&
      typeof p.y === 'number' && Number.isFinite(p.y)
    ) {
      return { x: p.x, y: p.y }
    }
    return null
  } catch (err) {
    logger.warn('Discarding malformed comic-book editor toolbar position', {
      key: POS_KEY,
      err: String(err),
    })
    return null
  }
}

/** Read + re-clamp the persisted position for this load (never throws). */
function loadPos(): ToolbarPos | null {
  if (typeof window === 'undefined') return null
  try {
    const pos = hydrateToolbarPos(window.localStorage.getItem(POS_KEY))
    if (!pos) return null
    return clampToolbarPos(
      pos,
      { w: MIN_VISIBLE, h: MIN_VISIBLE },
      { w: window.innerWidth, h: window.innerHeight },
    )
  } catch (err) {
    logger.warn('Could not read comic-book editor toolbar position', { key: POS_KEY, err: String(err) })
    return null
  }
}

function persistPos(pos: ToolbarPos): void {
  try {
    window.localStorage.setItem(POS_KEY, JSON.stringify(pos))
  } catch (err) {
    logger.warn('Could not persist comic-book editor toolbar position', { key: POS_KEY, err: String(err) })
  }
}

interface DragState {
  id: number
  startX: number
  startY: number
  origin: ToolbarPos
  size: Size
  last: ToolbarPos | null
}

export interface ToolbarDrag {
  /** Spread onto the toolbar root: dragged position (or {} for the CSS dock). */
  rootProps: { ref: RefObject<HTMLDivElement | null>; style: CSSProperties }
  /** Spread onto the drag grip (the toolbar title bar). */
  gripProps: {
    onPointerDown(e: ReactPointerEvent<HTMLDivElement>): void
    onPointerMove(e: ReactPointerEvent<HTMLDivElement>): void
    onPointerUp(e: ReactPointerEvent<HTMLDivElement>): void
  }
}

/**
 * Makes the editor toolbar draggable by its title grip so it can be moved off a
 * panel it covers. Position is the box's top-left in viewport px; `null` means
 * "never dragged" and leaves the CSS bottom-right dock in effect. A dragged
 * position is clamped to the viewport (the toolbar can't be lost off-screen)
 * and persists across reloads.
 */
export function useToolbarDrag(): ToolbarDrag {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<DragState | null>(null)
  const [pos, setPos] = useState<ToolbarPos | null>(loadPos)

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect()
    if (!rect) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origin: { x: rect.left, y: rect.top },
      size: { w: rect.width, h: rect.height },
      last: null,
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || d.id !== e.pointerId) return
    const next = clampToolbarPos(
      { x: d.origin.x + e.clientX - d.startX, y: d.origin.y + e.clientY - d.startY },
      d.size,
      { w: window.innerWidth, h: window.innerHeight },
    )
    d.last = next
    setPos(next)
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (d?.id !== e.pointerId) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    if (d.last) persistPos(d.last)
    drag.current = null
  }

  const style: CSSProperties = pos
    ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' }
    : {}

  return { rootProps: { ref, style }, gripProps: { onPointerDown, onPointerMove, onPointerUp } }
}
