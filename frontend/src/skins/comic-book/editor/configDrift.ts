import { canonical } from './configStamp'
import type { EditorConfig } from './types'

// What `layoutConfig.ts` gained since a working copy was hydrated from it — which is
// exactly what Save would write back over.
//
// ./configStamp.ts already answers *whether* the file moved. It cannot answer *what*
// moved, because a stamp is a hash: the only other thing it could be compared with is
// another hash. So the working copy now carries the whole config it came from (its
// `seedBase`), and this module is the diff between that and the one the bundle holds.
//
// The base is what makes the answer trustworthy. Comparing the working copy itself
// against the file would report every balloon the author has moved this afternoon as a
// difference — true, and useless, because the author already knows about those. Between
// the base and the file the author appears nowhere, so every line here is something
// somebody *else* did: a merge, a branch change, another tab's Save.
//
// The report is per panel because that is the unit an author can act on: ./configAdopt.ts
// takes the file's version of one panel without touching the rest of the page.

/** One panel the file has changed since this working copy started. */
export interface PanelDrift {
  /** Index into `panels`. */
  panel: number
  /** The panel's name in the file now — what the author will look for on screen. */
  label: string
  /** What changed there, in the author's words. Never empty. */
  changes: string[]
}

/** Everything the file has changed since a working copy was hydrated from it. */
export interface ConfigDrift {
  panels: PanelDrift[]
  /** Changes belonging to no single panel — the grids, the page names, the panel list. */
  page: string[]
}

/** True when the file has moved at all. The whole of "is this copy behind?". */
export function hasDrift(drift: ConfigDrift | null): boolean {
  return drift !== null && (drift.panels.length > 0 || drift.page.length > 0)
}

/**
 * The entries on one panel, as canonical strings. A multiset rather than a list: two
 * identical balloons on one panel are two balloons, and which of them is "the same one"
 * as an entry in the other config is not a question with an answer.
 */
function keysOn(entries: readonly { panel: number }[], panel: number): string[] {
  return entries.filter(e => e.panel === panel).map(canonical)
}

/** How many entries are in `to` and not in `from`, and how many the other way. */
function multisetDiff(from: string[], to: string[]): { added: number; removed: number } {
  const counts = new Map<string, number>()
  for (const k of from) counts.set(k, (counts.get(k) ?? 0) + 1)
  let added = 0
  for (const k of to) {
    const n = counts.get(k) ?? 0
    if (n > 0) counts.set(k, n - 1)
    else added += 1
  }
  let removed = 0
  for (const n of counts.values()) removed += n
  return { added, removed }
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`
}

/**
 * One line for a kind of entry, or null when nothing about it moved.
 *
 * An add and a remove of the same size is reported as a change rather than as both, since
 * that is what retuning a picture's framing looks like from here — every field of an entry
 * is in its key, so a moved balloon is a removal and an addition.
 */
function entryLine(from: string[], to: string[], noun: string): string | null {
  const { added, removed } = multisetDiff(from, to)
  if (added === 0 && removed === 0) return null
  const changed = Math.min(added, removed)
  const parts: string[] = []
  if (changed > 0) parts.push(`${plural(changed, noun)} changed`)
  if (added > changed) parts.push(`${plural(added - changed, noun)} added`)
  if (removed > changed) parts.push(`${plural(removed - changed, noun)} removed`)
  return parts.join(', ')
}

/** How the panel's phone-call layout moved, or null. */
function callLine(base: EditorConfig, seed: EditorConfig, panel: number): string | null {
  const was = base.callScenes.find(s => s.panel === panel)
  const now = seed.callScenes.find(s => s.panel === panel)
  if (!was && now) return 'became a phone call'
  if (was && !now) return 'stopped being a phone call'
  if (was && now && (was.cut !== now.cut || was.axis !== now.axis)) return 'the call seam moved'
  return null
}

/** The changes to one panel, in the order an author would read them. */
function panelChanges(base: EditorConfig, seed: EditorConfig, panel: number): string[] {
  const lines: string[] = []
  const call = callLine(base, seed, panel)
  if (call) lines.push(call)
  const pictures = entryLine(keysOn(base.images, panel), keysOn(seed.images, panel), 'picture')
  if (pictures) lines.push(pictures)
  const balloons = entryLine(keysOn(base.bubbles, panel), keysOn(seed.bubbles, panel), 'balloon')
  if (balloons) lines.push(balloons)
  if (base.panels[panel]?.label !== seed.panels[panel]?.label) lines.push('renamed')
  if (base.patterns[panel] !== seed.patterns[panel]) lines.push('a different background pattern')
  return lines
}

/**
 * What belongs to the page rather than to one panel. There is no adopting these one at a
 * time — a grid is the whole page's subdivision and a panel added to the list renumbers
 * nothing but is indexed by every ring — so they are reported and left to Reset.
 */
function pageChanges(base: EditorConfig, seed: EditorConfig): string[] {
  const lines: string[] = []
  const gained = seed.panels.length - base.panels.length
  if (gained > 0) lines.push(`${plural(gained, 'panel')} added to the page`)
  if (gained < 0) lines.push(`${plural(-gained, 'panel')} removed from the page`)
  if (canonical(base.grids) !== canonical(seed.grids)) lines.push('the panel shapes moved')
  if (canonical(base.pageLabels) !== canonical(seed.pageLabels)) lines.push('a page was renamed')
  if (canonical(base.chains) !== canonical(seed.chains)) lines.push('a conversation changed')
  return lines
}

/**
 * The whole diff, base → file. Panels are reported in page order and only when something
 * about them moved; a config that has not moved at all gives back two empty lists rather
 * than null, so callers ask {@link hasDrift} instead of checking for a sentinel.
 */
export function configDrift(base: EditorConfig, seed: EditorConfig): ConfigDrift {
  const panels: PanelDrift[] = []
  const count = Math.max(base.panels.length, seed.panels.length)
  for (let panel = 0; panel < count; panel += 1) {
    // A panel the file has dropped is not a panel to adopt: its entries are gone from
    // both lists and its slot is somebody else's now. `pageChanges` says the list shrank.
    if (panel >= seed.panels.length) continue
    const changes = panelChanges(base, seed, panel)
    if (changes.length > 0) {
      panels.push({ panel, label: seed.panels[panel]?.label ?? `Panel ${panel + 1}`, changes })
    }
  }
  return { panels, page: pageChanges(base, seed) }
}

/** One panel's drift as a single line: `Phone — became a phone call, 3 pictures added`. */
export function driftLine(drift: PanelDrift): string {
  return `${drift.label} — ${drift.changes.join(', ')}`
}
