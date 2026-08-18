import type { ImgTransform, BubbleTransform } from './types'

// Index parallel to PANEL_IMAGES in Layout.tsx. P0 is the logo.
// `spill: false` clips the image to the panel polygon (overflow hidden behind the
// panel edge); `anchor` is the CSS object-position the framing starts from.
export const PANEL_IMG_TRANSFORMS: ImgTransform[] = [
  { scale: 1, offsetX: 0, offsetY: 0, anchor: 'center center', spill: false },
  { scale: 1, offsetX: 0, offsetY: 0, anchor: 'center bottom', spill: false },
  { scale: 1, offsetX: 0, offsetY: 0, anchor: 'center bottom', spill: false },
  { scale: 1, offsetX: 0, offsetY: 0, anchor: 'center bottom', spill: false },
  { scale: 1, offsetX: 0, offsetY: 0, anchor: 'center bottom', spill: false },
  { scale: 1, offsetX: 0, offsetY: 0, anchor: 'center bottom', spill: false },
  { scale: 1, offsetX: 0, offsetY: 0, anchor: 'center bottom', spill: false },
  { scale: 1, offsetX: 0, offsetY: 0, anchor: 'center bottom', spill: false },
]

// Not parallel to PANEL_IMAGES: each bubble names its `panel`, a panel may own any
// number of them, and the array is ordered by panel only for readability. `type`/`text`
// are the resting content, `hoverType` and `clickType` the shapes to morph to on
// pointer-over and press (null = stay put), `tail` which way the tail points ('none'
// for no tail), and `linkTo` the bubble to join with a connector tube — an index into
// this array, which must name a bubble on the same panel. `spill: true` keeps the
// current look where bubbles float into the gutter.
//
// Two pairs ship linked — the logo's and the mechanic's — each pair being one speaker's
// line continuing across two balloons, so the second of each carries no tail and the
// tube does the joining. Their placement is nudged off the shared default so the two sit
// apart with a clear gap for the tube to span: overlapping bubbles draw no tube at all
// (tubeBetween returns null rather than a smudge). Those numbers are tuned for the
// landscape layout; the portrait and square layouts reshape the panels, so a pair may
// end up close enough there to drop its tube. Retune per layout in the editor.
export const PANEL_BUBBLE_TRANSFORMS: BubbleTransform[] = [
  { panel: 0, top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'soft', tail: 'down-left', text: "It's Carameli!", linkTo: 1, hoverType: 'cloud', clickType: 'lightning' },
  { panel: 0, top: 30, right: 45, width: 45, rotate: -5, spill: true, type: 'soft', tail: 'none', text: '...at your service!', linkTo: null, hoverType: 'cloud', clickType: 'lightning' },
  { panel: 1, top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'soft', tail: 'down-right', text: 'Number please!', linkTo: null, hoverType: 'jagged', clickType: 'lightning' },
  { panel: 2, top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'cloud', tail: 'down-left', text: 'I wonder...', linkTo: null, hoverType: 'soft', clickType: 'jagged' },
  { panel: 3, top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'lightning', tail: 'down-left', text: 'FIXED!', linkTo: 5, hoverType: 'jagged', clickType: 'soft' },
  { panel: 3, top: 30, right: 45, width: 45, rotate: -5, spill: true, type: 'soft', tail: 'none', text: '...for now.', linkTo: null, hoverType: 'cloud', clickType: 'jagged' },
  { panel: 4, top: -30, right: 30, width: 45, rotate: -5, spill: true, type: 'soft', tail: 'down-right', text: 'One moment please!', linkTo: null, hoverType: 'cloud', clickType: 'jagged' },
  { panel: 5, top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'jagged', tail: 'down-left', text: 'RING RING!', linkTo: null, hoverType: 'lightning', clickType: 'soft' },
  { panel: 6, top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'lightning', tail: 'down-left', text: 'Ka-POW!', linkTo: null, hoverType: 'soft', clickType: 'jagged' },
  { panel: 7, top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'cloud', tail: 'down-left', text: 'Delivering dreams...', linkTo: null, hoverType: 'soft', clickType: 'lightning' },
]
