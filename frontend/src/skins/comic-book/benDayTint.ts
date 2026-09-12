// Ben-Day tint — what colour a ripple dot is, as against benDayWash.ts's where it is
// and how big. The wash's grid, wave and timings are geometry; this is the paint, and
// the two are split because together they put the module past the 250-line rule.
//
// The ripple is one accent per route, and a whole sheet of dots at exactly that hue
// reads as printed stock. The tint turns each dot's hue around the accent by a slow,
// large-scale field, so colour moves through the sheet in soft blobs the way a lava
// lamp's does while the route still reads as the colour it was given.
//
// Three sines of incommensurate wavelength and rate — one across, one down, one along
// the diagonal — sum to a field with no period short enough to catch. Every wavelength
// is several times RIPPLE_WAVE_LEN and every rate a small fraction of RIPPLE_SPEED,
// which is the point of the tuning rather than an accident of it: the colour has to
// read as a second, far slower motion *through* the wave, not as the wave changing
// colour with it. benDayWash.test.ts holds that ordering against both modules.

import { clamp } from './editor/transforms'

/** ± degrees of hue the drift reaches either side of the route accent. */
export const TINT_SWING_DEG = 30
/** Hue steps the swing is quantised to before conversion (see `tintSteps`). */
export const TINT_STEP_DEG = 1

export const TINT_LEN_X = 1150     // px per colour cycle across the viewport
export const TINT_LEN_Y = 870      // px per colour cycle down it
export const TINT_LEN_DIAG = 1490  // px per colour cycle along x + y

export const TINT_RATE_X = 0.021   // colour cycles per second (one drift per ~48 s)
export const TINT_RATE_Y = 0.013
export const TINT_RATE_DIAG = 0.008

export function parseCssColor(hex: string): [number, number, number] {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return [r, g, b]
}

/**
 * The lava field at (x, y) and time `tSec`: -1..1, the fraction of TINT_SWING_DEG this
 * point's hue sits off the accent. Halving the sum rather than averaging it spends more
 * of the range on colour — three sines reach ±1.5, and the clamp flattens the rarer
 * excursions past ±1 into blob cores of the fullest hue, which is what the body of a
 * lava lamp looks like. The field is a pure function of *viewport* position, so every
 * surface drawing the same grid cell at the same instant gets the same colour for it.
 */
export function tintField(x: number, y: number, tSec: number): number {
    const sum = Math.sin((x / TINT_LEN_X - tSec * TINT_RATE_X) * Math.PI * 2)
        + Math.sin((y / TINT_LEN_Y + tSec * TINT_RATE_Y) * Math.PI * 2)
        + Math.sin(((x + y) / TINT_LEN_DIAG - tSec * TINT_RATE_DIAG) * Math.PI * 2)
    return clamp(sum / 2, -1, 1)
}

/** Hue in degrees, saturation and lightness in 0..1, of an 0..255 RGB triple. */
export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    const [rn, gn, bn] = [r / 255, g / 255, b / 255]
    const max = Math.max(rn, gn, bn)
    const min = Math.min(rn, gn, bn)
    const l = (max + min) / 2
    const span = max - min
    // A grey has no hue to turn, and is also where the saturation denominator is zero.
    if (span === 0) return [0, 0, l]
    const sixth = max === rn ? (gn - bn) / span
        : max === gn ? (bn - rn) / span + 2
            : (rn - gn) / span + 4
    return [((sixth * 60) % 360 + 360) % 360, span / (1 - Math.abs(2 * l - 1)), l]
}

/** The 0..255 RGB triple of a hue in degrees and a saturation/lightness in 0..1. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    const c = (1 - Math.abs(2 * l - 1)) * s
    const sector = ((h % 360 + 360) % 360) / 60
    const x = c * (1 - Math.abs(sector % 2 - 1))
    const m = l - c / 2
    const rgb = sector < 1 ? [c, x, 0]
        : sector < 2 ? [x, c, 0]
            : sector < 3 ? [0, c, x]
                : sector < 4 ? [0, x, c]
                    : sector < 5 ? [x, 0, c]
                        : [c, 0, x]
    return rgb.map(v => Math.round((v + m) * 255)) as [number, number, number]
}

/**
 * `accentHex` with its hue turned `deg` degrees, as the `r,g,b` body of an `rgba()`
 * string. Saturation and lightness stay the accent's own, so every colour the drift
 * reaches is that accent at another angle rather than a different paint.
 */
export function hueTurned(accentHex: string, deg: number): string {
    const [h, s, l] = rgbToHsl(...parseCssColor(accentHex))
    return hslToRgb(h + deg, s, l).join(',')
}

/**
 * A hue-turner for one accent that converts each distinct step once. The field is
 * continuous, but two hues a degree apart are one colour to the eye, so rounding to
 * TINT_STEP_DEG leaves a few dozen conversions a frame in place of one per dot — and a
 * full viewport is thousands of dots, on every frame of a loop that never stops.
 */
export function tintSteps(accentHex: string): (field: number) => string {
    const cache = new Map<number, string>()
    return field => {
        const step = Math.round(field * TINT_SWING_DEG / TINT_STEP_DEG)
        let rgb = cache.get(step)
        if (rgb === undefined) {
            rgb = hueTurned(accentHex, step * TINT_STEP_DEG)
            cache.set(step, rgb)
        }
        return rgb
    }
}
