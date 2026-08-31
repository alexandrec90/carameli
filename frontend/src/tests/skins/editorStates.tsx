import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'

import { defaultChain, peerPickerOn } from '../../skins/comic-book/bubbleChain'
import { seedConfig } from '../../skins/comic-book/editor/configSeed'
import EditorToolbar from '../../skins/comic-book/editor/EditorToolbar'
import { seamGeometry } from '../../skins/comic-book/editor/panelGridOps'
import type { EditMode, Selection, SelectionKind } from '../../skins/comic-book/editor/selection'
import { EDIT_MODES, SELECTION_KINDS } from '../../skins/comic-book/editor/selection'
import type { EditorConfig } from '../../skins/comic-book/editor/types'
import type { EditorModeApi } from '../../skins/comic-book/editor/useEditorMode'
import type { SeamDragApi } from '../../skins/comic-book/editor/useSeamDrag'

// Every state the editor's toolbar can be in, built from the editor's own definition of
// "state" rather than from a list kept here.
//
// The failure this exists to stop is not a bug in any one component — it is a feature
// going quietly unreachable. The panel-name field survived in content mode for months
// while shapes mode printed the same name as static text, and every test stayed green
// throughout, because each of them mounted one component against an api of `vi.fn()`s and
// so could not see that a whole half of the editor had stopped offering the control.
//
// The states come from `EDIT_MODES` and `SELECTION_KINDS` in `../../skins/comic-book/
// editor/selection.ts`. That is the load-bearing part: a hand-written matrix protects the
// features that existed the day it was written and silently ignores every one added
// after, which is exactly the failure being guarded against. Add a selection kind and the
// matrix grows a row on its own.

/** A viewport to place seams in; only the ratio matters, and nothing asserts on pixels. */
const FRAME = { x: 0, y: 0, w: 1000, h: 600 }

/** The panel used for panel selections: one that carries both a picture and a bubble. */
const PANEL = 9

/** One thing worth selecting: which index, and what makes it worth its own column. */
interface Variant {
  /** Distinguishes sibling states — `content/bubble[chained]`; '' for the plain one. */
  suffix: string
  index: number
}

/**
 * Which entries of the seeded config are worth selecting, per kind.
 *
 * One index per kind is not enough, and finding that out is what this harness is for: an
 * inspector can be gated on a *property* of the selected thing rather than on its kind,
 * and picking the first entry then never renders it. `ChainInspector` renders only when
 * the selected balloon is in a chain, so with `bubbles[0]` — which is not — four mutators
 * looked unreachable that are perfectly reachable from a chained balloon.
 *
 * The variants are found by predicate rather than by index, so they keep pointing at the
 * right thing as the shipped config is edited; a variant the config has no example of
 * drops out rather than selecting something that does not match.
 */
function variantsFor(kind: SelectionKind, config: EditorConfig): Variant[] {
  const pick = <T,>(list: T[], match: (item: T) => boolean, suffix: string): Variant[] => {
    const index = list.findIndex(match)
    return index === -1 ? [] : [{ suffix, index }]
  }

  switch (kind) {
    case 'panel':
      return [{ suffix: '', index: PANEL }]
    case 'img':
      return [
        ...pick(config.images, i => !i.table && !i.numberPad, ''),
        // A picture carrying a projected surface opens a whole second inspector.
        ...pick(config.images, i => Boolean(i.table), 'table'),
        ...pick(config.images, i => Boolean(i.numberPad), 'number pad'),
      ]
    case 'bubble':
      return [
        ...pick(config.bubbles, b => b.chain === '' && b.linkTo === null, ''),
        ...pick(config.bubbles, b => b.linkTo !== null, 'linked'),
        // The one that reaches the chain settings.
        ...pick(config.bubbles, b => b.chain !== '', 'chained'),
      ]
    default:
      return [{ suffix: '', index: 0 }]
  }
}

export interface EditorState {
  /** `content/panel`, `shapes/nothing` — the snapshot's row key, so it must be stable. */
  name: string
  mode: EditMode
  selected: Selection | null
  /**
   * An optional edit to the seeded config, applied before mounting.
   *
   * The escape hatch for a control that appears only when something is *missing*. Most
   * inspectors are gated on what is selected, and the matrix above reaches those by
   * selecting one of each; a repair affordance is gated on the selection being incomplete,
   * and the shipped config is complete, so no selection reaches it. Without this the guard
   * would report those controls' mutators unreachable and be right — nothing in the file
   * it can see does reach them — which is a true statement that fails a green editor.
   *
   * It is deliberately a small door. A new mutator is still red on the day it lands unless
   * someone gives it a control or a state, which is the property being bought.
   */
  derive?: (config: EditorConfig) => EditorConfig
}

/** The (mode, selection) grid, derived, with nothing selected included in each mode. */
const GRID_STATES: EditorState[] = (() => {
  const config = seedConfig()
  return EDIT_MODES.flatMap(mode => [
    { name: `${mode}/nothing`, mode, selected: null },
    ...SELECTION_KINDS.flatMap(kind =>
      variantsFor(kind, config).map(({ suffix, index }) => ({
        name: `${mode}/${kind}${suffix ? `[${suffix}]` : ''}`,
        mode,
        selected: { kind, index } as Selection,
      })),
    ),
  ])
})()

/** The chained balloon the repair states below are built around, if the config has one. */
const CHAINED = (() => {
  const config = seedConfig()
  const index = config.bubbles.findIndex(b => b.chain !== '')
  return index === -1 ? null : { index, bubble: config.bubbles[index] }
})()

/**
 * States a config reaches by being *incomplete*, each one an ordinary config with one
 * thing taken out of it.
 *
 * Both are conversations mid-assembly, which is a real thing to be looking at: a chain
 * whose second column has not been added yet, and a bound chain on a panel with no number
 * picker to bind to. `ChainInspector` offers a button to finish each, and those two
 * buttons are the only way to reach `addChainColumn` and `addPeerPickerOn`.
 *
 * They are written as subtractions from the shipped config rather than as configs of their
 * own so that they keep describing the same *situation* as the seed is edited, and drop
 * out cleanly if it ever ships no chain at all.
 */
const REPAIR_STATES: EditorState[] = CHAINED === null ? [] : [
  {
    name: 'content/bubble[chain of one]',
    mode: 'content',
    selected: { kind: 'bubble', index: CHAINED.index },
    // Unchain the balloon's partners, leaving it the only column of its conversation.
    derive: config => ({
      ...config,
      bubbles: config.bubbles.map((b, i) =>
        i !== CHAINED.index && b.chain === CHAINED.bubble.chain && b.panel === CHAINED.bubble.panel
          ? { ...b, chain: '', linkTo: null }
          : b,
      ),
    }),
  },
  {
    name: 'content/bubble[bound, no picker]',
    mode: 'content',
    selected: { kind: 'bubble', index: CHAINED.index },
    // Bind the conversation to a real thread and take away the panel's number picker, so
    // there is nothing for it to bind to. Pickers are found with the editor's own
    // `peerPickerOn` rather than by re-deciding here which contents count as one, and they
    // are retyped rather than deleted: removing a balloon would renumber the config out
    // from under `selected`.
    derive: config => {
      const bubbles = [...config.bubbles]
      for (let p = peerPickerOn(bubbles, CHAINED.bubble.panel); p !== -1;
        p = peerPickerOn(bubbles, CHAINED.bubble.panel)) {
        bubbles[p] = { ...bubbles[p], content: 'text' }
      }
      return {
        ...config,
        chains: config.chains.some(c => c.id === CHAINED.bubble.chain)
          ? config.chains.map(c => (c.id === CHAINED.bubble.chain ? { ...c, sms: true } : c))
          : [...config.chains, { ...defaultChain(CHAINED.bubble.chain), sms: true }],
        bubbles,
      }
    },
  },
]

/** Every state worth mounting, in a stable order — the grid, then the repair cases. */
export const EDITOR_STATES: EditorState[] = [...GRID_STATES, ...REPAIR_STATES]

/**
 * Enough of the shape-drag API for the shape inspector to render truthfully in each
 * state. The seams are the real ones computed from the seeded grid rather than a stub,
 * so a seam selection resolves to an actual segment with two real ends — a `[]` here
 * would send every seam state down the nothing-selected branch and quietly cost the
 * matrix a column.
 *
 * `canDeleteSelected` is true on a vertex selection because a real bend is removable, and
 * a control that is disabled in every state the matrix knows about reads as unreachable.
 */
export function dragFor(config: EditorConfig, selected: Selection | null): SeamDragApi {
  return {
    seams: seamGeometry(config.grids.classic.landscape, FRAME),
    selectedVertex: selected?.kind === 'vertex' ? selected.index : null,
    snapVertex: null,
    canDeleteSelected: selected?.kind === 'vertex',
    onVertexDown: vi.fn(),
    onSeamDown: vi.fn(),
    onSeamDoubleClick: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
    deleteSelected: vi.fn(),
  }
}

/**
 * Every method the editor exposes, as `vi.fn()`s over a real config. Built by listing the
 * keys explicitly — a `Proxy` would answer to any name and so could never report that one
 * had gone missing, which is half of what the reachability guard measures.
 */
export function mockApi(config: EditorConfig, mode: EditMode, selected: Selection | null): EditorModeApi {
  return {
    active: true,
    config,
    stale: false,
    selected,
    mode,
    setMode: vi.fn(),
    select: vi.fn(),
    clear: vi.fn(),
    resetAll: vi.fn(),
    setGridFor: vi.fn(),
    resetGridFor: vi.fn(),
    addImgOn: vi.fn(),
    addBubbleOn: vi.fn(),
    addSmsOn: vi.fn(),
    addPeerPickerOn: vi.fn(),
    setImg: vi.fn(),
    setBubble: vi.fn(),
    setChained: vi.fn(),
    setChain: vi.fn(),
    addChainColumn: vi.fn(),
    setPattern: vi.fn(),
    splitPanel: vi.fn(),
    setPanelLabel: vi.fn(),
    setPageLabel: vi.fn(),
    deleteImg: vi.fn(),
    deleteBubble: vi.fn(),
    resetOne: vi.fn(),
  }
}

/**
 * The toolbar in one state, wired the way `Layout.tsx` wires it — `onPageLabel` included,
 * because the page-name field is handed its callback through `pageSelect` rather than
 * reached off `api`, and a guard that missed that wiring would call the field reachable
 * while the name went nowhere.
 */
export function renderState(state: EditorState, api?: EditorModeApi): EditorModeApi {
  const seeded = seedConfig()
  const config = state.derive ? state.derive(seeded) : seeded
  const editor = api ?? mockApi(config, state.mode, state.selected)
  // The panel a new picture or bubble would land on: the selected panel, or the panel the
  // selected picture or balloon sits on — read off the item rather than assumed, so the
  // inspectors that name it show the panel the author is actually looking at.
  const selected = state.selected
  const selPanel =
    selected === null
      ? null
      : selected.kind === 'panel'
        ? selected.index
        : selected.kind === 'img'
          ? (editor.config.images[selected.index]?.panel ?? null)
          : selected.kind === 'bubble'
            ? (editor.config.bubbles[selected.index]?.panel ?? null)
            : null

  render(
    <MemoryRouter>
      <EditorToolbar
        api={editor}
        selPanel={selPanel}
        pageSelect={{
          navItems: [],
          pageLabels: editor.config.pageLabels,
          previewingLoading: false,
          onPreviewLoading: vi.fn(),
          onPageLabel: editor.setPageLabel,
        }}
        shapes={{
          page: 'classic',
          kind: 'landscape',
          grid: editor.config.grids.classic.landscape,
          drag: dragFor(editor.config, state.selected),
        }}
      />
    </MemoryRouter>,
  )
  return editor
}

/**
 * How a control announces itself to an author: a button by its lettering, a field by the
 * `<span>` its `.cb-ed-field` label wraps, otherwise an explicit `aria-label`.
 */
export function labelOf(el: Element): string {
  if (el.tagName === 'BUTTON') return el.textContent?.trim() ?? ''
  const aria = el.getAttribute('aria-label')
  if (aria) return aria
  const span = el.closest('label')?.querySelector('span')
  if (span) return span.textContent?.trim() ?? ''
  return el.getAttribute('placeholder') ?? '(unnamed)'
}

/** Every operable element in the toolbar, in DOM order. */
export function controlsIn(): HTMLElement[] {
  const toolbar = screen.getByRole('region', { name: 'Comic-book editor' })
  return [...toolbar.querySelectorAll<HTMLElement>('button, input, select, textarea')]
}

/** One control as `kind: name` — `text: panel name`, `button: Save`. */
export function describeControl(el: Element): string {
  const kind = el instanceof HTMLInputElement ? el.type : el.tagName.toLowerCase()
  return `${kind}: ${labelOf(el)}`
}

/** Every operable thing in the toolbar as `kind: name`, sorted so order is not asserted. */
export function controlSurface(): string[] {
  return controlsIn().map(describeControl).sort()
}
