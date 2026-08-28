import { describe, expect, it } from 'vitest'

import { hydrateConfig } from '../../skins/comic-book/editor/configOps'
import {
  isPanelList,
  nextPanelLabel,
  setPanelLabel,
  splitPanel,
} from '../../skins/comic-book/editor/configPanels'
import { LAYOUT_KINDS, seedConfig, shippedGridFor } from '../../skins/comic-book/editor/configSeed'
import { PANEL_GRIDS, PANELS } from '../../skins/comic-book/editor/layoutConfig'
import { gridProblems } from '../../skins/comic-book/editor/panelGridValidate'
import { serializeConfigFile } from '../../skins/comic-book/editor/serialize'
import { PANEL_PAGES } from '../../skins/comic-book/panels'

// Everything that has to lengthen together when a panel is made: the list, the pattern
// per panel, and the ring table of all six grids. The cut itself is panelGridCut.test.ts.

/** A shipped classic-page panel with a picture on it, so the remap has something to hold. */
const PARENT = seedConfig().images[0].panel
const VIEW = { kind: 'landscape' as const, viewport: { w: 1600, h: 900 } }

describe('isPanelList', () => {
  it('accepts the shipped list and an empty one', () => {
    expect(isPanelList(PANELS)).toBe(true)
    expect(isPanelList([])).toBe(true)
  })

  it('rejects anything that is not an array of well-formed panels', () => {
    expect(isPanelList(undefined)).toBe(false)
    expect(isPanelList('Logo')).toBe(false)
    expect(isPanelList([null])).toBe(false)
    expect(isPanelList([{ label: 'X', isLogo: false }])).toBe(false)
    expect(isPanelList([{ label: 'X', isLogo: 'no', page: 'classic' }])).toBe(false)
    expect(isPanelList([{ label: 7, isLogo: false, page: 'classic' }])).toBe(false)
    expect(isPanelList([{ label: 'X', isLogo: false, page: 'attic' }])).toBe(false)
  })
})

describe('nextPanelLabel', () => {
  it('numbers from 2, off the stem of the parent’s label', () => {
    expect(nextPanelLabel('Mechanic', ['Mechanic'])).toBe('Mechanic 2')
    expect(nextPanelLabel('Mailman 1', ['Mailman 1', 'Mailman 2'])).toBe('Mailman 3')
    expect(nextPanelLabel('Logo', ['Logo', 'Logo 2', 'Logo 3'])).toBe('Logo 4')
    expect(nextPanelLabel('Logo 2', ['Logo', 'Logo 2'])).toBe('Logo 3')
  })

  it('never hands back the bare stem, and names a blank one', () => {
    expect(nextPanelLabel('Mechanic', [])).toBe('Mechanic 2')
    expect(nextPanelLabel('', [])).toBe('Panel 2')
    expect(nextPanelLabel('  ', ['Panel 2'])).toBe('Panel 3')
  })
})

describe('splitPanel', () => {
  it('appends one panel, one pattern and one ring to every grid, cutting on its own page', () => {
    const cfg = seedConfig()
    const result = splitPanel(cfg, 3, 'across')
    expect(result).not.toBeNull()
    const { config, index } = result!
    expect(index).toBe(PANELS.length)
    expect(config.panels).toHaveLength(PANELS.length + 1)
    expect(config.panels[index]).toEqual({ label: 'Mechanic 2', isLogo: false, page: 'classic' })
    expect(config.patterns).toHaveLength(PANELS.length + 1)
    expect(config.patterns[index]).toBe(cfg.patterns[3])
    for (const page of PANEL_PAGES) {
      for (const kind of LAYOUT_KINDS) {
        const grid = config.grids[page][kind]
        expect(grid.panels).toHaveLength(PANELS.length + 1)
        expect(gridProblems(grid, PANELS.length + 1)).toEqual([])
        if (page === 'classic') {
          expect(grid.panels[3].length).toBeGreaterThanOrEqual(3)
          expect(grid.panels[index].length).toBeGreaterThanOrEqual(3)
        } else {
          expect(grid.panels[index]).toEqual([])
        }
      }
    }
  })

  it('numbers past a sibling that already carries the next number', () => {
    // Shipped: `Mailman 1` and `Mailman 2`.
    const result = splitPanel(seedConfig(), 2, 'down')!
    expect(result.config.panels[result.index].label).toBe('Mailman 3')
  })

  it('splits a home-page panel on the home grids and pads the classic ones', () => {
    const home = PANELS.findIndex(p => p.page === 'home')
    const result = splitPanel(seedConfig(), home, 'down')!
    expect(result.config.panels[result.index].page).toBe('home')
    for (const kind of LAYOUT_KINDS) {
      expect(result.config.grids.classic[kind].panels[result.index]).toEqual([])
      expect(result.config.grids.home[kind].panels[result.index].length).toBeGreaterThanOrEqual(3)
    }
  })

  it('does not touch the config it was given', () => {
    const cfg = seedConfig()
    const before = JSON.stringify(cfg)
    splitPanel(cfg, 3, 'across', VIEW)
    expect(JSON.stringify(cfg)).toBe(before)
  })

  it('holds pictures and bubbles still only in the grid on screen', () => {
    const cfg = seedConfig()
    const onParent = cfg.images.map((img, i) => (img.panel === PARENT ? i : -1)).filter(i => i >= 0)
    expect(onParent.length).toBeGreaterThan(0)

    // No view: nothing is remapped, the picture simply names the (now smaller) parent.
    const blind = splitPanel(cfg, PARENT, 'across')!.config
    expect(blind.images).toEqual(cfg.images)

    // A view: the parent's pictures are re-expressed against its new box, the rest not.
    const seen = splitPanel(cfg, PARENT, 'across', VIEW)!.config
    onParent.forEach(i => {
      expect(seen.images[i].panel).toBe(PARENT)
      expect(seen.images[i]).not.toEqual(cfg.images[i])
    })
    cfg.images.forEach((img, i) => {
      if (img.panel !== PARENT) expect(seen.images[i]).toEqual(img)
    })
  })

  it('refuses whole when any one grid of the page refuses', () => {
    const cfg = seedConfig()
    cfg.grids.classic.portrait.panels[3] = []
    expect(splitPanel(cfg, 3, 'across')).toBeNull()
    expect(splitPanel(cfg, 3, 'down')).toBeNull()
  })

  it('refuses a panel that is not on the list', () => {
    expect(splitPanel(seedConfig(), PANELS.length, 'across')).toBeNull()
    expect(splitPanel(seedConfig(), -1, 'across')).toBeNull()
  })

  it('survives a save and a reload', () => {
    const grown = splitPanel(seedConfig(), 3, 'across', VIEW)!.config
    expect(hydrateConfig(JSON.stringify(grown))).toEqual(grown)
    const file = serializeConfigFile(grown)
    expect(file).toContain("{ label: 'Mechanic 2', isLogo: false, page: 'classic' },")
    expect((file.match(/^ {2}\{ label: /gm) ?? []).length).toBe(PANELS.length + 1)
  })

  it('can be split again, and the new panel too', () => {
    const once = splitPanel(seedConfig(), 3, 'across')!
    const twice = splitPanel(once.config, once.index, 'down')!
    expect(twice.index).toBe(PANELS.length + 1)
    expect(twice.config.panels[twice.index].label).toBe('Mechanic 3')
    for (const kind of LAYOUT_KINDS) {
      expect(gridProblems(twice.config.grids.classic[kind], PANELS.length + 2)).toEqual([])
    }
  })
})

describe('setPanelLabel', () => {
  it('renames one panel in a copy, leaving the rest and the original alone', () => {
    const cfg = seedConfig()
    const out = setPanelLabel(cfg, 3, 'Garage')
    expect(out.panels[3]).toEqual({ ...cfg.panels[3], label: 'Garage' })
    expect(out.panels.filter((_, i) => i !== 3)).toEqual(cfg.panels.filter((_, i) => i !== 3))
    expect(cfg.panels[3].label).toBe('Mechanic')
  })

  it('is a plain copy for an index off the list', () => {
    const cfg = seedConfig()
    expect(setPanelLabel(cfg, 99, 'Nowhere')).toEqual(cfg)
  })
})

describe('shippedGridFor', () => {
  it('pads the shipped grid with empty rings up to the asked count', () => {
    const grid = shippedGridFor('classic', 'landscape', PANELS.length + 2)
    expect(grid.panels).toHaveLength(PANELS.length + 2)
    expect(grid.panels.slice(0, PANELS.length)).toEqual(PANEL_GRIDS.classic.landscape.panels)
    expect(grid.panels.slice(PANELS.length)).toEqual([[], []])
    expect(grid).not.toBe(PANEL_GRIDS.classic.landscape)
  })

  it('is the shipped grid itself at the shipped count', () => {
    expect(shippedGridFor('home', 'square', PANELS.length)).toEqual(PANEL_GRIDS.home.square)
  })
})
