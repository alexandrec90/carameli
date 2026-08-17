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

// Index parallel to PANEL_IMAGES. `type`/`text` are the resting content, `hoverType`
// and `clickType` the shapes to morph to on pointer-over and press (null = stay put),
// and `linkTo` the bubble to join with a connector tube. `spill: true` keeps the
// current look where bubbles float into the gutter.
//
// Two pairs ship linked — P0↔P1 across the top and P3↔P4 across the middle. Their
// placement is nudged off the shared default so the two bubbles of a pair sit apart
// with a clear gap for the tube to span: overlapping bubbles draw no tube at all
// (tubeBetween returns null rather than a smudge). Those numbers are tuned for the
// landscape layout; the portrait and square layouts move the panels, so a pair may
// end up close enough there to drop its tube. Retune per layout in the editor.
export const PANEL_BUBBLE_TRANSFORMS: BubbleTransform[] = [
  { top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'soft', text: "It's Carameli!", linkTo: 1, hoverType: 'cloud', clickType: 'lightning' },        // 0 logo
  { top: -30, right: 35, width: 45, rotate: -5, spill: true, type: 'soft', text: 'Number please!', linkTo: null, hoverType: 'jagged', clickType: 'lightning' },      // 1 switchboard
  { top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'cloud', text: 'I wonder...', linkTo: null, hoverType: 'soft', clickType: 'jagged' },            // 2 mailman1
  { top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'lightning', text: 'FIXED!', linkTo: 4, hoverType: 'jagged', clickType: 'soft' },                // 3 mechanic
  { top: -30, right: 30, width: 45, rotate: -5, spill: true, type: 'soft', text: 'One moment please!', linkTo: null, hoverType: 'cloud', clickType: 'jagged' },      // 4 receptionist
  { top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'jagged', text: 'RING RING!', linkTo: null, hoverType: 'lightning', clickType: 'soft' },         // 5 rolodex
  { top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'lightning', text: 'Ka-POW!', linkTo: null, hoverType: 'soft', clickType: 'jagged' },            // 6 rotary phone
  { top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'cloud', text: 'Delivering dreams...', linkTo: null, hoverType: 'soft', clickType: 'lightning' }, // 7 mailman2
]
