import type { ImgTransform, BubbleTransform } from './types'

// Not parallel to PANELS: each picture names its `panel`, so a panel may own several or
// none, and the array is ordered by panel only for readability. `src`/`alt` are the
// picture itself; `left`/`top`/`width`/`height` are its frame, in % of the panel box,
// and may go negative or past 100 to hang the frame off an edge.
// `scale`/`offsetX`/`offsetY`/`anchor` then frame the picture *inside* its frame;
// `spill: false` clips it to the panel, `spill: true` lets it bleed into the gutter —
// the same question, and the same answer, as a bubble's `spill`.
//
// The eight ship on a -5/-5/110/110 frame rather than on 0/0/100/100, and the
// difference is the point rather than a tweak. A frame of exactly 0/0/100/100 *is* the
// panel box: the editor draws its selection outline in the same place it draws the
// panel's, so there is no picture to grab that is distinguishable from the slot it sits
// in — which was the original complaint. Art that overhangs the window it is read
// through is also the ordinary comic relationship, and it is the one framing that keeps
// covering when the grid reflows (`computeLayout` reshapes every panel between the
// landscape, portrait and square layouts). Retune any of them in the editor and Save.
export const PANEL_IMG_TRANSFORMS: ImgTransform[] = [
  { panel: 0, src: '/comic-book/logo.webp', alt: 'Carameli', left: -5, top: -5, width: 110, height: 110, scale: 1, offsetX: 0, offsetY: 0, anchor: 'center center', spill: false },
  { panel: 1, src: '/comic-book/switchboard.webp', alt: 'Switchboard', left: -5, top: -5, width: 110, height: 110, scale: 1, offsetX: 0, offsetY: 0, anchor: 'center bottom', spill: false },
  { panel: 2, src: '/comic-book/mailman1.webp', alt: 'Mail carrier', left: -5, top: -5, width: 110, height: 110, scale: 1, offsetX: 0, offsetY: 0, anchor: 'center bottom', spill: false },
  { panel: 3, src: '/comic-book/mechanic.webp', alt: 'Mechanic', left: -5, top: -5, width: 110, height: 110, scale: 1, offsetX: 0, offsetY: 0, anchor: 'center bottom', spill: false },
  { panel: 4, src: '/comic-book/receptionist.webp', alt: 'Receptionist', left: -5, top: -5, width: 110, height: 110, scale: 1, offsetX: 0, offsetY: 0, anchor: 'center bottom', spill: false },
  { panel: 5, src: '/comic-book/rolodex.webp', alt: 'Rolodex', left: -5, top: -5, width: 110, height: 110, scale: 1, offsetX: 0, offsetY: 0, anchor: 'center bottom', spill: false },
  { panel: 6, src: '/comic-book/rotary%20phone.webp', alt: 'Rotary phone', left: -5, top: -5, width: 110, height: 110, scale: 1, offsetX: 0, offsetY: 0, anchor: 'center bottom', spill: false },
  { panel: 7, src: '/comic-book/mailman2.webp', alt: 'Post office', left: -5, top: -5, width: 110, height: 110, scale: 1, offsetX: 0, offsetY: 0, anchor: 'center bottom', spill: false },
]

// Not parallel to PANELS either: each bubble names its `panel`, a panel may own any
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
  { panel: 1, top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'soft', tail: 'down-right', text: 'Number please!', linkTo: null, hoverType: 'cloud', clickType: 'lightning' },
  { panel: 2, top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'cloud', tail: 'down-left', text: 'I wonder...', linkTo: null, hoverType: 'soft', clickType: 'lightning' },
  { panel: 3, top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'lightning', tail: 'down-left', text: 'FIXED!', linkTo: 5, hoverType: 'cloud', clickType: 'soft' },
  { panel: 3, top: 30, right: 45, width: 45, rotate: -5, spill: true, type: 'soft', tail: 'none', text: '...for now.', linkTo: null, hoverType: 'cloud', clickType: 'lightning' },
  { panel: 4, top: -30, right: 30, width: 45, rotate: -5, spill: true, type: 'soft', tail: 'down-right', text: 'One moment please!', linkTo: null, hoverType: 'cloud', clickType: 'lightning' },
  { panel: 5, top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'lightning', tail: 'down-left', text: 'RING RING!', linkTo: null, hoverType: 'cloud', clickType: 'soft' },
  { panel: 6, top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'lightning', tail: 'down-left', text: 'Ka-POW!', linkTo: null, hoverType: 'soft', clickType: 'cloud' },
  { panel: 7, top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'cloud', tail: 'down-left', text: 'Delivering dreams...', linkTo: null, hoverType: 'soft', clickType: 'lightning' },
]
