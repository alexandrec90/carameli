// The spotlight — the pointer as the one light on the Ben-Day dot grid.
//
// The loading sheet, the letterbox around the page and the page-transition wash all
// draw the same grid of accent dots on paper (benDayWash.ts). What moves it is this: a
// pool of light that follows the cursor, and every dot swells and darkens by how far
// inside it it sits. Past the light's reach the grid rests, small and faint.
//
// The light is a pure step function over where the pointer last was, and one tracker
// per window holds it, so every surface sampling the same instant draws the same light.
// That is what lets the loading sheet wash away over a letterbox already lit where the
// sheet was lit, with only the page itself new. Nothing here consults
// prefers-reduced-motion: the grid moves only as the hand does, and a light that stopped
// following the pointer would read as the page having hung, not as a preference honoured.

/** px from the centre to where the light has faded out entirely. */
export const SPOT_REACH = 260
/** Time constant, ms, of the centre's chase after the pointer. */
export const SPOT_FOLLOW_MS = 70
/** Time constant, ms, of the light coming up on arrival and going out after a leave. */
export const SPOT_FADE_MS = 320

/** Under these, the ease is declared arrived, so a settled light is a settled state. */
const SETTLE_PRESENCE = 0.005
const SETTLE_PX = 0.05

export interface Pointer {
    x: number
    y: number
}

export interface SpotlightState {
    /** Centre in viewport px. Where the light last was while it is out. */
    x: number
    y: number
    /** 0..1: how much of the light shows — up while a pointer is in the window, else out. */
    presence: number
}

/** No light at all: the state every tracker starts from, and what a bare draw takes. */
export const SPOT_OFF: Readonly<SpotlightState> = Object.freeze({ x: 0, y: 0, presence: 0 })

/** 1 at the centre, 0 at SPOT_REACH and beyond, a raised cosine between. */
export function spotlightFalloff(dist: number): number {
    if (dist >= SPOT_REACH) return 0
    return (1 + Math.cos((Math.PI * dist) / SPOT_REACH)) / 2
}

/** How lit the point (x, y) is under `spot`, 0..1: the falloff scaled by presence. */
export function spotlightAt(spot: SpotlightState, x: number, y: number): number {
    if (spot.presence <= 0) return 0
    return spot.presence * spotlightFalloff(Math.hypot(x - spot.x, y - spot.y))
}

/** The fraction of the way to a target an exponential ease of time constant `tauMs` covers in `dtMs`. */
export function easeFraction(dtMs: number, tauMs: number): number {
    return 1 - Math.exp(-dtMs / tauMs)
}

/**
 * The light `dtMs` after `prev`, given where the pointer is (or null for out of the
 * window). The centre chases the pointer; presence eases up toward 1 while a pointer is
 * in and down toward 0 once it has left. A light that had gone out comes back on where
 * the pointer is rather than gliding over from where it last was. Returns `prev` itself
 * when nothing moved, so a caller can skip a repaint by identity.
 */
export function stepSpotlight(
    prev: SpotlightState, pointer: Pointer | null, dtMs: number,
): SpotlightState {
    const goal = pointer ? 1 : 0
    let presence = prev.presence + (goal - prev.presence) * easeFraction(dtMs, SPOT_FADE_MS)
    if (Math.abs(goal - presence) < SETTLE_PRESENCE) presence = goal
    if (!pointer) {
        return presence === prev.presence ? prev : { x: prev.x, y: prev.y, presence }
    }
    let { x, y } = pointer
    if (prev.presence > 0) {
        const k = easeFraction(dtMs, SPOT_FOLLOW_MS)
        x = prev.x + (pointer.x - prev.x) * k
        y = prev.y + (pointer.y - prev.y) * k
        if (Math.abs(pointer.x - x) < SETTLE_PX) x = pointer.x
        if (Math.abs(pointer.y - y) < SETTLE_PX) y = pointer.y
    }
    if (x === prev.x && y === prev.y && presence === prev.presence) return prev
    return { x, y, presence }
}

export interface SpotlightTracker {
    /**
     * Start following the pointer. The listeners are up while any acquirer holds on;
     * the returned release is idempotent, and the last one puts the tracker back to rest.
     */
    acquire(): () => void
    /**
     * The light at `nowMs`, stepped on from the last sample. The same instant gets the
     * same answer, and an instant no later than the last sampled advances nothing, so
     * two loops in one frame agree and a wall-clock read beside a rAF stamp is harmless.
     */
    sample(nowMs: number): SpotlightState
}

/**
 * A tracker over this window's pointer. Until the pointer has spoken the light rests at
 * `rest()` — the loading screen's legend sits in it — and it goes to the cursor at the
 * first move. It goes out when the pointer leaves the window, on the same `mouseleave`
 * the panel hover uses (usePanelHover.ts).
 */
export function createSpotlightTracker(rest: () => Pointer | null): SpotlightTracker {
    // undefined: never seen, so at rest; null: left the window.
    let pointer: Pointer | null | undefined
    let state: SpotlightState = SPOT_OFF
    let lastMs: number | null = null
    let holders = 0

    const onMove = (e: PointerEvent) => { pointer = { x: e.clientX, y: e.clientY } }
    const onLeave = () => { pointer = null }

    return {
        acquire() {
            if (holders === 0) {
                window.addEventListener('pointermove', onMove)
                document.documentElement.addEventListener('mouseleave', onLeave)
            }
            holders += 1
            let released = false
            return () => {
                if (released) return
                released = true
                holders -= 1
                if (holders > 0) return
                window.removeEventListener('pointermove', onMove)
                document.documentElement.removeEventListener('mouseleave', onLeave)
                pointer = undefined
                state = SPOT_OFF
                lastMs = null
            }
        },
        sample(nowMs) {
            if (lastMs !== null && nowMs <= lastMs) return state
            const dt = lastMs === null ? 0 : nowMs - lastMs
            lastMs = nowMs
            state = stepSpotlight(state, pointer === undefined ? rest() : pointer, dt)
            return state
        },
    }
}

let shared: SpotlightTracker | null = null

/** The one tracker the page's surfaces share, resting at the centre of the viewport. */
export function pageSpotlight(): SpotlightTracker {
    shared ??= createSpotlightTracker(
        () => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 }),
    )
    return shared
}
