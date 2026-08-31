import { cleanup, fireEvent } from '@testing-library/react'
import type { Mock } from 'vitest'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import type { EditorModeApi } from '../../skins/comic-book/editor/useEditorMode'
import { controlsIn, describeControl, EDITOR_STATES, renderState } from './editorStates'

// Can an author still get at every edit the editor can make?
//
// This is the guard the panel-name regression actually needed, and the one the other
// editor tests structurally cannot be. `setPanelLabel` was never removed — it stayed on
// the api, it stayed correct, `InspectorPanelNames.test.tsx` stayed green — and it was
// still lost, because in shapes mode nothing on screen called it. A test that asserts a
// mutator *works* cannot see that; only a test that asks what happens when you operate
// the controls can.
//
// So: mount every state, press every button and type in every field, and record which
// api method each one reaches. The result is a map from mutator to the controls that can
// invoke it, and the property worth enforcing falls out of it — **a mutator no control
// reaches is a lost feature**, whatever else is green.
//
// The method list is read off the api at runtime rather than written here, so a mutator
// added next year is held to the same rule the day it is added, with nobody having to
// remember this file exists. That is the difference between a guard that protects today's
// features and one that protects tomorrow's.

vi.mock('../../skins/comic-book/editor/useToolbarColumns', () => ({
  useToolbarColumns: () => ({ columnCount: 3, width: 710 }),
}))

vi.mock('../../lib/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}))

/**
 * Mutators no toolbar control is expected to reach, each with the reason. This is the
 * valve that keeps the guard from being a straitjacket: a genuinely canvas-driven edit
 * gets one line here and the suite stays honest about it.
 *
 * It is held down from both directions — `every exemption still names a real method`
 * fails when one is deleted, and `the exempt list holds nothing the toolbar reaches`
 * fails when a control starts reaching one. Neither lets an entry rot into a blanket
 * excuse, which is what an unchecked ignore list becomes.
 */
const DRIVEN_ELSEWHERE: Record<string, string> = {
  clear:
    'the Escape key and a click on the page background, both handled by EditorOverlay ' +
    'rather than by any control in the toolbar',
}

/** Every function on the api, read off the object so a new mutator joins the rule for free. */
function methodsOf(api: EditorModeApi): string[] {
  return Object.entries(api as unknown as Record<string, unknown>)
    .filter(([, value]) => typeof value === 'function')
    .map(([key]) => key)
    .sort()
}

function callCount(api: EditorModeApi, method: string): number {
  return (api as unknown as Record<string, Mock>)[method].mock.calls.length
}

/**
 * Operate one control the way an author would: press a button, tick a box, type into a
 * field, pick a different option. The value typed is never asserted on — all that is
 * being measured is which mutator the control is wired to.
 */
function operate(el: HTMLElement): void {
  if (el instanceof HTMLInputElement) {
    if (el.disabled) return
    if (el.type === 'checkbox' || el.type === 'radio') {
      fireEvent.click(el)
      return
    }
    fireEvent.change(el, { target: { value: el.type === 'number' ? '7' : 'probe' } })
    return
  }
  if (el instanceof HTMLSelectElement) {
    if (el.disabled) return
    const other = [...el.options].find(option => option.value !== el.value)
    if (other) fireEvent.change(el, { target: { value: other.value } })
    return
  }
  if (el instanceof HTMLTextAreaElement) {
    if (!el.disabled) fireEvent.change(el, { target: { value: 'probe' } })
    return
  }
  if (el instanceof HTMLButtonElement && el.disabled) return
  fireEvent.click(el)
}

/** `method -> the controls that reach it`, as `state → control`. */
const reached = new Map<string, string[]>()

/**
 * `state → control` for anything that threw while being operated, with what it threw.
 *
 * Operating a control must not abort the sweep — one transport button that cannot finish
 * in happy-dom would cost every state after it — but a throw may not be *discarded*
 * either: a control that exists and crashes reaches no mutator, and would otherwise be
 * indistinguishable from a control that was never wired. So it is recorded and written
 * into the committed map, where it reads as `(threw)` beside the control and lands in a
 * diff the first time it happens.
 */
const threw = new Map<string, string>()
let apiMethods: string[] = []

/**
 * The sweep is one React mount per (state, control) — several hundred of them — which
 * runs in a couple of seconds on its own and well past vitest's 10s hook default when the
 * whole suite is competing for the machine. The budget is generous on purpose: trimming
 * it would mean sampling the controls, and a guard that probes some of them is a guard
 * that reports a feature reachable because it never looked.
 */
const SWEEP_TIMEOUT_MS = 120_000

beforeAll(() => {
  // The transport buttons talk to the dev save endpoint and the clipboard. Neither is
  // what is being measured, and neither may throw its way out of the sweep.
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}'))))

  for (const state of EDITOR_STATES) {
    renderState(state)
    const total = controlsIn().length
    cleanup()

    // One fresh mount per control: pressing a control can change the toolbar under us
    // (the refused-split note appears, an inspector section opens), and probing a stale
    // node would silently measure nothing.
    for (let i = 0; i < total; i++) {
      const api = renderState(state)
      if (apiMethods.length === 0) apiMethods = methodsOf(api)

      const control = controlsIn()[i]
      const where = `${state.name} → ${describeControl(control)}`
      try {
        operate(control)
      } catch (error) {
        threw.set(where, error instanceof Error ? error.message : String(error))
      }

      for (const method of apiMethods) {
        if (callCount(api, method) > 0) {
          reached.set(method, [...(reached.get(method) ?? []), where])
        }
      }
      cleanup()
    }
  }
}, SWEEP_TIMEOUT_MS)

describe('every editor mutator stays reachable', () => {
  // The assertion this file exists for.
  it('leaves no mutator that nothing on screen can invoke', () => {
    const unreachable = apiMethods.filter(
      method => !reached.has(method) && !(method in DRIVEN_ELSEWHERE),
    )

    expect(
      unreachable,
      'these editor mutators are wired to nothing an author can operate — either give ' +
        'each one a control, or add it to DRIVEN_ELSEWHERE with the gesture that drives it',
    ).toEqual([])
  })

  // Renaming is the feature that was lost, so it is also stated outright: a snapshot
  // records what is true, and this records what must stay true.
  it.each([['setPanelLabel'], ['setPageLabel'], ['splitPanel'], ['resetAll']])(
    '%s is reachable from the toolbar',
    method => {
      expect(reached.get(method) ?? []).not.toHaveLength(0)
    },
  )

  // Both halves of the editor must offer renaming, which is precisely what regressed.
  it('reaches the panel name from content mode and from shapes mode alike', () => {
    const modes = new Set((reached.get('setPanelLabel') ?? []).map(where => where.split('/')[0]))

    expect([...modes].sort()).toEqual(['content', 'shapes'])
  })

  // The valve, held shut from the other side. An exemption is a claim that the toolbar
  // cannot reach a mutator, and this is what makes the claim falsifiable: the moment a
  // control does reach it, the exemption is a lie that would go on excusing the mutator
  // after the control that justified dropping it was itself removed. There is no
  // allowance for "reachable, but only in one state" — that is what reachable means, and
  // an inline exception here would be an ignore list inside the ignore list.
  it('the exempt list holds nothing the toolbar actually reaches', () => {
    const exemptButReachable = Object.keys(DRIVEN_ELSEWHERE).filter(method => reached.has(method))

    expect(
      exemptButReachable,
      'these have a control now, so drop them from DRIVEN_ELSEWHERE and let the sweep cover them',
    ).toEqual([])
  })

  it('every exemption still names a real method', () => {
    const gone = Object.keys(DRIVEN_ELSEWHERE).filter(method => !apiMethods.includes(method))

    expect(gone, 'these exemptions name methods the api no longer has').toEqual([])
  })

  // The map itself, so that a change in what reaches what is reviewable rather than
  // merely pass/fail. Regenerate with `npm --prefix frontend run test:run -- -u`.
  it('matches the committed reachability map', async () => {
    const body = apiMethods
      .map(method => {
        const where = reached.get(method)
        if (!where) return `## ${method}\n\n- (no toolbar control) — ${DRIVEN_ELSEWHERE[method]}\n`
        return (
          `## ${method}\n\n` +
          `${[...new Set(where)]
            .sort()
            .map(w => `- ${w}${threw.has(w) ? ` (threw: ${threw.get(w)})` : ''}`)
            .join('\n')}\n`
        )
      })
      .join('\n')

    // Controls that threw and reached nothing appear nowhere above, so they are listed
    // here — otherwise the one failure mode this sweep cannot tell from an unwired
    // control would leave no trace at all.
    const silent = [...threw].filter(([where]) => ![...reached.values()].flat().includes(where))
    const crashes = silent.length === 0
      ? ''
      : `\n## (controls that threw and reached nothing)\n\n` +
        `${silent.map(([where, why]) => `- ${where} — ${why}`).sort().join('\n')}\n`

    await expect(
      `# Which control reaches which editor mutator\n\n` +
        `Generated by \`src/tests/skins/EditorReachability.test.tsx\` — do not hand-edit.\n` +
        `Regenerate with \`npm --prefix frontend run test:run -- -u\`.\n\n` +
        `A mutator listed with no control is one an author cannot invoke from the toolbar.\n\n` +
        body +
        crashes,
    ).toMatchFileSnapshot('./__snapshots__/editor-reachability.md')
  })
})
