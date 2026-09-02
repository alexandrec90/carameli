import { driftLine } from './configDrift'
import type { ConfigDrift } from './configDrift'

// The "layoutConfig.ts moved under this tab" block, and what to do about it.
//
// It used to be three sentences of prose ending in "Reset takes the current file instead,
// discarding the work in this tab" — true, and the reason nobody pressed it. An author who
// has spent an afternoon reframing a page will not throw it away to recover a feature they
// cannot see, so the file's version of that feature stayed lost until somebody merged the
// two halves by hand in git. That happened four times.
//
// So the block names the panels the file has moved on and puts a button on each. Adopting
// one takes the file's version of that panel and leaves every other panel alone — the merge
// that was being done by hand, done by the thing that knows which side is whose.

interface StaleNoticeProps {
  /** True when Save would overwrite a `layoutConfig.ts` this working copy never saw. */
  stale: boolean
  /** What moved, or null for a copy with no record of the file it came from. */
  drift: ConfigDrift | null
  /** True for that copy: the warning is about the gap itself, not about a difference. */
  untracked: boolean
  onAdopt(panel: number): void
}

export default function StaleNotice({ stale, drift, untracked, onAdopt }: StaleNoticeProps) {
  // An untracked copy gets its line only once something is actually at stake — which for a
  // copy nobody can diff is any time at all, so it is shown alongside staleness rather than
  // instead of it. A copy that is neither says nothing.
  if (!stale && !untracked) return null
  return (
    <div className="cb-ed-unfinished cb-ed-stale" role="status" aria-label="Working copy is behind the file">
      <p className="cb-ed-unfinished-head">
        {stale
          ? 'layoutConfig.ts has changed since this working copy started.'
          : 'This working copy does not say which layoutConfig.ts it came from.'}
      </p>
      {untracked ? (
        <p className="cb-ed-stale-body">
          It was saved before the editor started recording that, so nothing here can tell you
          what a Save would write over. Save or Ship the work in this tab, then press Reset
          once — from that point this block names the panels the file has moved on and offers
          to take them.
        </p>
      ) : (
        <p className="cb-ed-stale-body">
          Something moved the file under this tab — a merge, a branch change, or a Save from
          another one. Saving writes this copy over it, reverting whatever that was. Take
          names the file&apos;s version of one panel and leaves the rest of your work alone;
          Reset takes the whole file and discards this tab.
        </p>
      )}
      {drift !== null && drift.panels.length > 0 && (
        <ul className="cb-ed-stale-list">
          {drift.panels.map(panel => (
            <li key={panel.panel}>
              <span className="cb-ed-stale-what">{driftLine(panel)}</span>
              <button
                type="button"
                className="cb-ed-stale-take"
                onClick={() => onAdopt(panel.panel)}
                title={`Replace panel ${panel.panel + 1} with the file's version`}
              >
                Take
              </button>
            </li>
          ))}
        </ul>
      )}
      {drift !== null && drift.page.length > 0 && (
        <ul className="cb-ed-stale-list cb-ed-stale-page">
          {/* No button: a grid belongs to the whole page and a panel added to the list is
              indexed by every ring, so neither can be taken one panel at a time. */}
          {drift.page.map(line => (
            <li key={line}>
              <span className="cb-ed-stale-what">{line}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
