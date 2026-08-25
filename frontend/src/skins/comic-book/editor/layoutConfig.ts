import type { PanelBgStyle } from '../panelPatterns'
import type { ImgTransform, BubbleTransform, PageGrids } from './types'

// Not parallel to PANELS: each picture names its `panel`, so a panel may own several or
// none, and the array is ordered by panel only for readability. `src`/`alt` are the
// picture itself; `left`/`top`/`width`/`height` are its frame, in % of the panel box,
// and may go negative or past 100 to hang the frame off an edge. That frame is cut to
// the panel's own polygon scaled into it, so an inset picture reads as a smaller comic
// panel rather than as a bare rectangle. `scale`/`offsetX`/`offsetY`/`anchor` then
// frame the picture *inside* its frame; `spill: false` clips it there, `spill: true`
// lets it bleed past.
//
// A picture with a `table` is a **surface**: an HTML table is projected onto it, so a
// photographed notepad can hold live rows. `quad` is the four corners of that surface in
// % of the frame, clockwise from top-left, and they are what tilts it — four corners fix
// a projective map exactly, which is what a plane in a photograph needs and three
// rotation angles cannot express. Drag them onto the drawn lines in the editor. `rows` is
// how many bands the surface is cut into, so a row always lands on the same line however
// far the reader has scrolled; `header` spends the first band on the column labels.
// `data` is every row, of which only `rows` are on screen at once — the wheel moves a
// whole row at a time and there is no scrollbar. Outside the editor only those values
// show: no outline, no guides, no bar.
export const PANEL_IMG_TRANSFORMS: ImgTransform[] = [
  { panel: 0, src: '/comic-book/logo.webp', alt: 'Carameli', left: 0, top: 0, width: 100, height: 100, scale: 1, offsetX: 0, offsetY: 0, anchor: 'center center', spill: false },
  { panel: 1, src: '/comic-book/switchboard.webp', alt: 'Switchboard', left: 0, top: 0, width: 100, height: 100, scale: 1, offsetX: 0, offsetY: 0, anchor: 'center bottom', spill: false },
  { panel: 2, src: '/comic-book/mailman1.webp', alt: 'Mail carrier', left: 0, top: 0, width: 100, height: 100, scale: 1, offsetX: 0, offsetY: 0, anchor: 'center bottom', spill: false },
  { panel: 3, src: '/comic-book/mechanic.webp', alt: 'Mechanic', left: 0, top: 0, width: 100, height: 100, scale: 1, offsetX: 0, offsetY: 0, anchor: 'center bottom', spill: false },
  { panel: 4, src: '/comic-book/receptionist.webp', alt: 'Receptionist', left: 0, top: 0, width: 100, height: 100, scale: 1, offsetX: 0, offsetY: 0, anchor: 'center bottom', spill: false },
  { panel: 5, src: '/comic-book/rolodex.webp', alt: 'Rolodex', left: 0, top: 0, width: 100, height: 100, scale: 1, offsetX: 0, offsetY: 0, anchor: 'center bottom', spill: false },
  { panel: 6, src: '/comic-book/rotary%20phone.webp', alt: 'Rotary phone', left: 0, top: 0, width: 100, height: 100, scale: 1, offsetX: 0, offsetY: 0, anchor: 'center bottom', spill: false },
  { panel: 7, src: '/comic-book/mailman2.webp', alt: 'Post office', left: 0, top: 0, width: 100, height: 100, scale: 1, offsetX: 0, offsetY: 0, anchor: 'center bottom', spill: false },
  { panel: 8, src: '/comic-book/logo2.webp', alt: 'Carameli', left: 0, top: 0, width: 100, height: 100, scale: 1, offsetX: 0, offsetY: 0, anchor: 'center center', spill: false },
  { panel: 9, src: '/comic-book/notepad.webp', alt: 'Notepad', left: 0, top: 0, width: 100, height: 100, scale: 1, offsetX: 0, offsetY: 0, anchor: 'center bottom', spill: false },
  { panel: 10, src: '/comic-book/push-button-phone.webp', alt: 'Push-button phone', left: 0, top: 0, width: 100, height: 100, scale: 1, offsetX: 0, offsetY: 0, anchor: 'center bottom', spill: false },
  { panel: 11, src: '/comic-book/man-woman-talking.webp', alt: 'Phone conversation', left: 0, top: 0, width: 100, height: 100, scale: 1, offsetX: 0, offsetY: 0, anchor: 'center bottom', spill: false },
]

// Not parallel to PANELS either: each bubble names its `panel`, a panel may own any
// number of them, and the array is ordered by panel only for readability. `type`/`text`
// are the resting content, `hoverType` and `clickType` the shapes to morph to on
// pointer-over and press (null = stay put), `tail` which way the tail points ('none'
// for no tail), and `linkTo` the bubble to join with a connector tube — an index into
// this array, which must name a bubble on the same panel. `spill: true` keeps the
// current look where bubbles float into the gutter. `content` picks how `text` reads:
// 'text' letters it as-is; 'wheel' splits it into comma-delimited options; 'input'
// makes it editable; and 'phone' makes it an editable, region-formatted phone number.
//
// Two pairs ship linked — the logo's and the mechanic's — each pair being one speaker's
// line continuing across two balloons, so the second of each carries no tail and the
// tube does the joining. Their placement is nudged off the shared default so the two sit
// apart with a clear gap for the tube to span: overlapping bubbles draw no tube at all
// (tubeBetween returns null rather than a smudge). Those numbers are tuned for the
// landscape layout; the portrait and square layouts reshape the panels, so a pair may
// end up close enough there to drop its tube. Retune per layout in the editor.
export const PANEL_BUBBLE_TRANSFORMS: BubbleTransform[] = [
  { panel: 0, top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'soft', tail: 'down-left', content: 'text', text: "It's Carameli!", linkTo: 1, hoverType: 'cloud', clickType: 'lightning' },
  { panel: 0, top: 30, right: 45, width: 45, rotate: -5, spill: true, type: 'soft', tail: 'none', content: 'text', text: '...at your service!', linkTo: null, hoverType: 'cloud', clickType: 'lightning' },
  { panel: 1, top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'soft', tail: 'down-right', content: 'text', text: 'Number please!', linkTo: null, hoverType: 'cloud', clickType: 'lightning' },
  { panel: 2, top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'cloud', tail: 'down-left', content: 'text', text: 'I wonder...', linkTo: null, hoverType: 'soft', clickType: 'lightning' },
  { panel: 3, top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'lightning', tail: 'down-left', content: 'text', text: 'FIXED!', linkTo: 5, hoverType: 'cloud', clickType: 'soft' },
  { panel: 3, top: 30, right: 45, width: 45, rotate: -5, spill: true, type: 'soft', tail: 'none', content: 'text', text: '...for now.', linkTo: null, hoverType: 'cloud', clickType: 'lightning' },
  { panel: 4, top: -30, right: 30, width: 45, rotate: -5, spill: true, type: 'soft', tail: 'down-right', content: 'text', text: 'One moment please!', linkTo: null, hoverType: 'cloud', clickType: 'lightning' },
  { panel: 5, top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'lightning', tail: 'down-left', content: 'text', text: 'RING RING!', linkTo: null, hoverType: 'cloud', clickType: 'soft' },
  { panel: 6, top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'lightning', tail: 'down-left', content: 'text', text: 'Ka-POW!', linkTo: null, hoverType: 'soft', clickType: 'cloud' },
  { panel: 7, top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'cloud', tail: 'down-left', content: 'text', text: 'Delivering dreams...', linkTo: null, hoverType: 'soft', clickType: 'lightning' },
  { panel: 8, top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'soft', tail: 'down-left', content: 'text', text: "It's Carameli!", linkTo: null, hoverType: 'cloud', clickType: 'lightning' },
  { panel: 9, top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'soft', tail: 'down-right', content: 'text', text: 'Taking notes!', linkTo: null, hoverType: 'cloud', clickType: 'lightning' },
  { panel: 10, top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'lightning', tail: 'down-left', content: 'text', text: 'RING RING!', linkTo: null, hoverType: 'cloud', clickType: 'soft' },
  { panel: 11, top: -35, right: -12, width: 55, rotate: -5, spill: true, type: 'cloud', tail: 'down-left', content: 'text', text: 'Hello?', linkTo: null, hoverType: 'soft', clickType: 'lightning' },
]

// The one array here that IS parallel to PANELS: a pattern belongs to the panel slot
// itself, not to a picture or a bubble on it, so entry `i` is the Ben-Day background
// drawn behind `PANELS[i]` — whichever page that panel sits on. Only the style name is
// the author's choice; the colors and dot metrics stay tuned per panel in
// panelPatterns.ts (PANEL_BG_CONFIGS), so switching a panel's pattern keeps its
// palette. A retired or misspelled name falls back to the shipped default on hydrate
// rather than failing the draw.
export const PANEL_PATTERNS: PanelBgStyle[] = [
  'halftone-gradient', // Logo
  'sunburst', // Switchboard
  'color-block', // Mailman 1
  'vignette', // Mechanic
  'radial-dots', // Receptionist
  'diagonal-stripes', // Rolodex
  'concentric-rings', // Rotary phone
  'corner-burst', // Mailman 2
  'radial-dots', // Logo 2
  'diagonal-stripes', // Notepad
  'concentric-rings', // Push-button phone
  'sunburst', // Conversation
]

// The panel shapes themselves: one record per page, one grid per viewport shape inside
// it. `vertices` are the corners of the whole page in normalised frame space — 0 to 1
// across the frame, y down — and each entry of `panels` is one panel as a clockwise
// ring of indices into that table. Every grid's ring table is index-parallel to PANELS
// across *both* pages: a panel that sits on the other page keeps its slot as an empty
// ring, so a panel index means the same thing everywhere.
//
// Corners are **shared**: the divider between two panels is the run of vertices both
// rings name, so moving one moves the line on both sides and the two cannot come apart.
// A vertex added part-way along a divider bends it; repeat that and the divider is a
// lightning bolt.
//
// Two things are deliberately not in here. The **outer frame** is not stored — it is the
// viewport inset by OUTER_M, and a vertex sitting on it may only slide along it, a frame
// corner not at all. Nor is the **gutter**: every panel is shrunk by the same
// HALF_GUTTER perpendicular to each of its own edges as it is drawn, so the margins stay
// equal however far the lines are leant over. Both live in ../panelGeometry.ts, and
// neither is editable — which is what keeps every page on this grid recognisably the
// same page.
export const PANEL_GRIDS: PageGrids = {
  classic: {
    landscape: {
      vertices: [[0, 0], [0.2551, 0], [0.2449, 0.4171], [0, 0.4143], [0.7437, 0], [0.7563, 0.4229], [1, 0], [1, 0.4257], [0.2956, 0.4177], [0.3044, 0.7518], [0, 0.7545], [0.7551, 0.4229], [0.7449, 0.7478], [1, 0.7455], [0.5538, 0.7495], [0.5462, 1], [0, 1], [1, 1]],
      panels: [
        [0, 1, 2, 3], // Logo
        [1, 4, 5, 11, 8, 2], // Switchboard
        [4, 6, 7, 5], // Mailman 1
        [3, 2, 8, 9, 10], // Mechanic
        [8, 11, 12, 14, 9], // Receptionist
        [11, 5, 7, 13, 12], // Rolodex
        [10, 9, 14, 15, 16], // Rotary phone
        [14, 12, 13, 17, 15], // Mailman 2
        [], // Logo 2
        [], // Notepad
        [], // Push-button phone
        [], // Conversation
      ],
    },
    portrait: {
      vertices: [[0, 0], [0.4423, 0], [0.4577, 0.2202], [0, 0.2225], [1, 0], [1, 0.2175], [0.5602, 0.2197], [0.5398, 0.5003], [0, 0.4966], [1, 0.5034], [0.3936, 0.4993], [0.4064, 0.7505], [0, 0.7525], [1, 0.7475], [0.6089, 0.7494], [0.5911, 1], [0, 1], [1, 1]],
      panels: [
        [0, 1, 2, 3], // Logo
        [1, 4, 5, 6, 2], // Switchboard
        [3, 2, 6, 7, 10, 8], // Mailman 1
        [6, 5, 9, 7], // Mechanic
        [8, 10, 11, 12], // Receptionist
        [10, 7, 9, 13, 14, 11], // Rolodex
        [12, 11, 14, 15, 16], // Rotary phone
        [14, 13, 17, 15], // Mailman 2
        [], // Logo 2
        [], // Notepad
        [], // Push-button phone
        [], // Conversation
      ],
    },
    square: {
      vertices: [[0, 0], [0.3071, 0], [0.2929, 0.3783], [0, 0.3759], [0.7109, 0], [0.7291, 0.3819], [1, 0], [1, 0.3841], [0.4739, 0.3798], [0.4861, 0.7201], [0, 0.7251], [1, 0.7149], [0.2851, 0.7222], [0.2749, 1], [0, 1], [0.6429, 0.7185], [0.6571, 1], [1, 1]],
      panels: [
        [0, 1, 2, 3], // Logo
        [1, 4, 5, 8, 2], // Switchboard
        [4, 6, 7, 5], // Mailman 1
        [3, 2, 8, 9, 12, 10], // Mechanic
        [8, 5, 7, 11, 15, 9], // Receptionist
        [10, 12, 13, 14], // Rolodex
        [12, 9, 15, 16, 13], // Rotary phone
        [15, 11, 17, 16], // Mailman 2
        [], // Logo 2
        [], // Notepad
        [], // Push-button phone
        [], // Conversation
      ],
    },
  },
  home: {
    landscape: {
      vertices: [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0.45], [1, 0.43], [0.33, 0], [0.35, 0.443], [0.47, 0.4405], [0.45, 1]],
      panels: [
        [], // Logo
        [], // Switchboard
        [], // Mailman 1
        [], // Mechanic
        [], // Receptionist
        [], // Rolodex
        [], // Rotary phone
        [], // Mailman 2
        [0, 6, 7, 4], // Logo 2
        [6, 1, 5, 8, 7], // Notepad
        [4, 7, 8, 9, 3], // Push-button phone
        [8, 5, 2, 9], // Conversation
      ],
    },
    portrait: {
      vertices: [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0.45], [1, 0.43], [0.41, 0], [0.43, 0.4414], [0.47, 0.4405], [0.45, 1]],
      panels: [
        [], // Logo
        [], // Switchboard
        [], // Mailman 1
        [], // Mechanic
        [], // Receptionist
        [], // Rolodex
        [], // Rotary phone
        [], // Mailman 2
        [0, 6, 7, 4], // Logo 2
        [6, 1, 5, 8, 7], // Notepad
        [4, 7, 8, 9, 3], // Push-button phone
        [8, 5, 2, 9], // Conversation
      ],
    },
    square: {
      vertices: [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0.45], [1, 0.43], [0.33, 0], [0.35, 0.443], [0.47, 0.4405], [0.45, 1]],
      panels: [
        [], // Logo
        [], // Switchboard
        [], // Mailman 1
        [], // Mechanic
        [], // Receptionist
        [], // Rolodex
        [], // Rotary phone
        [], // Mailman 2
        [0, 6, 7, 4], // Logo 2
        [6, 1, 5, 8, 7], // Notepad
        [4, 7, 8, 9, 3], // Push-button phone
        [8, 5, 2, 9], // Conversation
      ],
    },
  },
}
