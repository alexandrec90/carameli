import { describe, expect, it } from 'vitest'

import { resolveEditFlag, shouldRevealImg } from '../../skins/comic-book/editor/useEditorMode'

// The pure parts of the editor-mode hook. Everything that edits the config itself
// lives in configOps.ts and is covered by editorConfigOps.test.ts.

describe('resolveEditFlag', () => {
  it('?edit=1 activates and persists the flag', () => {
    expect(resolveEditFlag('1', null)).toEqual({ active: true, storedFlag: '1' })
    expect(resolveEditFlag('1', '1')).toEqual({ active: true, storedFlag: '1' })
  })

  it('?edit=0 deactivates and clears the flag, even when previously persisted', () => {
    expect(resolveEditFlag('0', '1')).toEqual({ active: false, storedFlag: null })
    expect(resolveEditFlag('0', null)).toEqual({ active: false, storedFlag: null })
  })

  it('without the param, the persisted flag decides', () => {
    expect(resolveEditFlag(null, '1')).toEqual({ active: true, storedFlag: '1' })
    expect(resolveEditFlag(null, null)).toEqual({ active: false, storedFlag: null })
  })

  it('unrecognized param values fall back to the persisted flag', () => {
    expect(resolveEditFlag('true', '1')).toEqual({ active: true, storedFlag: '1' })
    expect(resolveEditFlag('', null)).toEqual({ active: false, storedFlag: null })
  })

  it('clears a stale non-"1" stored value', () => {
    expect(resolveEditFlag(null, 'garbage')).toEqual({ active: false, storedFlag: null })
  })

  it('toggles back and forth across loads (1 → 0 → 1)', () => {
    const on = resolveEditFlag('1', null)
    expect(on.active).toBe(true)
    const off = resolveEditFlag('0', on.storedFlag)
    expect(off.active).toBe(false)
    // A plain reload after ?edit=0 stays out of edit mode…
    expect(resolveEditFlag(null, off.storedFlag).active).toBe(false)
    // …and ?edit=1 re-enters it.
    expect(resolveEditFlag('1', off.storedFlag).active).toBe(true)
  })
})

describe('shouldRevealImg', () => {
  it('reveals only the selected image panel', () => {
    const selected = { kind: 'img', index: 3 } as const
    expect(shouldRevealImg(true, selected, 3)).toBe(true)
    expect(shouldRevealImg(true, selected, 2)).toBe(false)
  })

  it('does not reveal when the editor is inactive', () => {
    expect(shouldRevealImg(false, { kind: 'img', index: 3 }, 3)).toBe(false)
  })

  it('does not reveal when nothing is selected', () => {
    expect(shouldRevealImg(true, null, 0)).toBe(false)
  })

  // A bubble selection index is an index into the bubble array, which no longer has
  // anything to do with a panel index — reading it as one would uncrop a random panel.
  it('does not reveal when a bubble (not the image) is selected', () => {
    expect(shouldRevealImg(true, { kind: 'bubble', index: 3 }, 3)).toBe(false)
  })
})
