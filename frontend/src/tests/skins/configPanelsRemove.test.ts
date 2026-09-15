import { describe, expect, it } from 'vitest'

import { splitPanel } from '../../skins/comic-book/editor/configPanels'
import { deletePanel, hiddenOn, hidePanelOn, showPanelOn } from '../../skins/comic-book/editor/configPanelsRemove'
import { LAYOUT_KINDS, seedConfig } from '../../skins/comic-book/editor/configSeed'
import { PANELS } from '../../skins/comic-book/editor/layoutConfig'
import { absorbPanel } from '../../skins/comic-book/editor/panelGridAbsorb'
import { gridProblems } from '../../skins/comic-book/editor/panelGridValidate'
import type { EditorConfig } from '../../skins/comic-book/editor/types'
import { frameRect } from '../../skins/comic-book/panelGeometry'
import { PANEL_PAGES } from '../../skins/comic-book/panels'

// Everything that has to go together when a panel leaves: one grid (hide), or the list
// and all six grids and the content (delete). The geometry is panelGridAbsorb.test.ts.

/** A shipped classic-page panel with a picture on it. */
const PANEL = seedConfig().images[0].panel
const PAGE = PANELS[PANEL].page
const VIEW = { kind: 'landscape' as const, frame: frameRect(1600, 900, 'landscape') }

function everyGridSound(config: EditorConfig): void {
  for (const page of PANEL_PAGES) {
    for (const kind of LAYOUT_KINDS) {
      expect(config.grids[page][kind].panels).toHaveLength(config.panels.length)
      expect(gridProblems(config.grids[page][kind], config.panels.length)).toEqual([])
    }
  }
}

describe('hiddenOn', () => {
  it('is empty for the shipped config, which draws every panel on every shape', () => {
    for (const page of PANEL_PAGES) {
      for (const kind of LAYOUT_KINDS) expect(hiddenOn(seedConfig(), page, kind)).toEqual([])
    }
  })
})

describe('hidePanelOn', () => {
  it('empties the ring on that shape only, keeping the panel, its content and the other two shapes', () => {
    const seed = seedConfig()
    const out = hidePanelOn(seed, PANEL, 'landscape')
    expect(out).not.toBeNull()
    const config = out!
    expect(config.panels).toEqual(seed.panels)
    expect(config.patterns).toEqual(seed.patterns)
    expect(config.grids[PAGE].landscape.panels[PANEL]).toEqual([])
    expect(config.grids[PAGE].portrait).toEqual(seed.grids[PAGE].portrait)
    expect(config.grids[PAGE].square).toEqual(seed.grids[PAGE].square)
    expect(hiddenOn(config, PAGE, 'landscape')).toEqual([PANEL])
    expect(hiddenOn(config, PAGE, 'portrait')).toEqual([])
    everyGridSound(config)
    // The pictures still name their panel; they are just not drawn at this shape.
    expect(config.images.filter(i => i.panel === PANEL)).toHaveLength(
      seed.images.filter(i => i.panel === PANEL).length,
    )
  })

  it('holds the absorbing neighbour’s content still on screen, and nobody else’s', () => {
    const seed = seedConfig()
    const into = absorbPanel(seed.grids[PAGE].landscape, PANEL)!.into
    const config = hidePanelOn(seed, PANEL, 'landscape', VIEW)!
    config.images.forEach((img, i) => {
      if (img.panel !== into) expect(img).toEqual(seed.images[i])
    })
    // Without a view nothing is remapped at all.
    expect(hidePanelOn(seed, PANEL, 'landscape')!.images).toEqual(seed.images)
  })

  it('refuses a panel already off that shape, and one off the list', () => {
    const once = hidePanelOn(seedConfig(), PANEL, 'landscape')!
    expect(hidePanelOn(once, PANEL, 'landscape')).toBeNull()
    expect(hidePanelOn(seedConfig(), 99, 'landscape')).toBeNull()
  })
})

describe('showPanelOn', () => {
  it('brings a hidden panel back as half of the panel it is cut from, on that shape only', () => {
    const seed = seedConfig()
    const into = absorbPanel(seed.grids[PAGE].landscape, PANEL)!.into
    const hidden = hidePanelOn(seed, PANEL, 'landscape')!
    const out = showPanelOn(hidden, PANEL, 'landscape', into, 'across')
    expect(out).not.toBeNull()
    const config = out!
    expect(config.grids[PAGE].landscape.panels[PANEL].length).toBeGreaterThanOrEqual(3)
    expect(hiddenOn(config, PAGE, 'landscape')).toEqual([])
    expect(config.grids[PAGE].portrait).toEqual(seed.grids[PAGE].portrait)
    expect(config.panels).toEqual(seed.panels)
    everyGridSound(config)
  })

  it('refuses a panel that is not hidden there, and a cut from the other page', () => {
    const seed = seedConfig()
    expect(showPanelOn(seed, PANEL, 'landscape', PANEL + 1, 'across')).toBeNull()
    const hidden = hidePanelOn(seed, PANEL, 'landscape')!
    const elsewhere = seed.panels.findIndex(p => p.page !== PAGE)
    expect(showPanelOn(hidden, PANEL, 'landscape', elsewhere, 'across')).toBeNull()
  })
})

describe('deletePanel', () => {
  it('drops the slot from the list, the patterns and all six grids, and renumbers what names a later panel', () => {
    const seed = seedConfig()
    const out = deletePanel(seed, PANEL)
    expect(out).not.toBeNull()
    const config = out!
    expect(config.panels).toHaveLength(seed.panels.length - 1)
    expect(config.panels[PANEL]).toEqual(seed.panels[PANEL + 1])
    expect(config.patterns).toHaveLength(seed.patterns.length - 1)
    expect(config.patterns[PANEL]).toBe(seed.patterns[PANEL + 1])
    everyGridSound(config)

    // Its own content is gone; everything after it moved down one; everything before stayed.
    expect(config.images.filter(i => i.panel === PANEL)).toHaveLength(
      seed.images.filter(i => i.panel === PANEL + 1).length,
    )
    const before = seed.images.filter(i => i.panel < PANEL)
    expect(config.images.slice(0, before.length)).toEqual(before)
    expect(config.images.some(i => i.panel >= config.panels.length)).toBe(false)
    expect(config.bubbles.some(b => b.panel >= config.panels.length)).toBe(false)
    for (const scene of config.callScenes) {
      const was = seed.callScenes.find(s => s.panel === scene.panel + (scene.panel >= PANEL ? 1 : 0))
      expect(was).toBeDefined()
    }
    expect(config.callScenes).toHaveLength(seed.callScenes.filter(s => s.panel !== PANEL).length)
    // Links survive the splice as links to bubbles, not to slots.
    for (const b of config.bubbles) {
      expect(b.linkTo === null || (b.linkTo >= 0 && b.linkTo < config.bubbles.length)).toBe(true)
    }
  })

  it('deletes a panel the editor made, and one already hidden on a shape', () => {
    const made = splitPanel(seedConfig(), PANEL, 'across')!
    const gone = deletePanel(made.config, made.index)!
    expect(gone.panels).toEqual(seedConfig().panels)
    everyGridSound(gone)

    const hidden = hidePanelOn(made.config, made.index, 'portrait')!
    const gone2 = deletePanel(hidden, made.index)!
    expect(gone2.panels).toHaveLength(seedConfig().panels.length)
    everyGridSound(gone2)
  })

  it('refuses a panel off the list, and refuses whole when a grid cannot give the space away', () => {
    expect(deletePanel(seedConfig(), 99)).toBeNull()
    // A page reduced to one drawn panel on one shape: nothing there can take its space.
    const seed = seedConfig()
    const onPage = seed.panels.flatMap((p, i) => (p.page === PAGE ? [i] : []))
    let lone: EditorConfig | null = seed
    for (const i of onPage) {
      if (i === PANEL || !lone) continue
      lone = hidePanelOn(lone, i, 'square')
    }
    expect(lone).not.toBeNull()
    expect(lone!.grids[PAGE].square.panels[PANEL].length).toBeGreaterThanOrEqual(3)
    expect(deletePanel(lone!, PANEL)).toBeNull()
  })
})
