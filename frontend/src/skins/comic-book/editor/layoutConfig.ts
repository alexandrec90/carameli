import type { ImgTransform, BubbleTransform } from './types'

// Index parallel to PANEL_IMAGES in Layout.tsx. P0 is the logo.
// Confirmed against Layout.tsx: only the logo used objectPosition 'center center';
// every other panel used 'center bottom'. `spill: false` clips the image to the
// panel polygon (overflow hidden behind the panel edge).
export const PANEL_IMG_TRANSFORMS: ImgTransform[] = [
  { scale: 1, offsetX: 0, offsetY: 0, anchor: 'center center', spill: false }, // 0 logo
  ...Array.from({ length: 7 }, () => (
    { scale: 1, offsetX: 0, offsetY: 0, anchor: 'center bottom', spill: false }
  )),
]

// Index parallel to PANEL_IMAGES. Geometry defaults match today's .cb-panel-bubble
// CSS; `type`/`text` are the per-panel content (source of truth — Layout.tsx reads
// these). `spill: true` keeps the current look where bubbles float into the gutter.
export const PANEL_BUBBLE_TRANSFORMS: BubbleTransform[] = [
  { top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'soft', text: "It's Carameli!" },        // 0 logo
  { top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'soft', text: 'Number please!' },        // 1 switchboard
  { top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'cloud', text: 'I wonder...' },           // 2 mailman1
  { top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'lightning', text: 'FIXED!' },            // 3 mechanic
  { top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'soft', text: 'One moment please!' },     // 4 receptionist
  { top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'jagged', text: 'RING RING!' },           // 5 rolodex
  { top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'lightning', text: 'Ka-POW!' },           // 6 rotary phone
  { top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'cloud', text: 'Delivering dreams...' },  // 7 mailman2
]
