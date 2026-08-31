import { useEffect, useMemo, useState } from 'react'

import { api } from '../api/client'
import { DEMO_VS_CUSTOMER_ID } from '../lib/constants'
import { logger } from '../lib/logger'
import {
  callRows,
  LIVE_TABLE_LIMIT,
  mergeRows,
  smsRows,
  type LiveTableRows,
  type TableSource,
} from '../lib/liveTables'
import { detectSimTables, simFeedRows } from '../lib/simTables'

/**
 * Live call and SMS records for whatever is drawing them.
 *
 * This is the only place a projected table touches the API: the skin asks for a feed by
 * name and gets cells back, exactly as a page asks its hook for rows. Everything about
 * *which* records and *how often* lives here; everything about the shape of a row lives in
 * `lib/liveTables.ts`; the skin owns neither.
 *
 * **Live is a poll, not a push.** There is no socket or event stream in this deployment,
 * and a call's row is written by the Jambonz call-status callbacks as it rings, answers
 * and ends — so re-asking is enough to watch a call happen, and it costs one request per
 * feed per interval against endpoints that already exist.
 */

/** How often a visible page re-asks. Roughly a ring's worth of latency. */
export const LIVE_TABLE_POLL_MS = 5000

/** The answer for a page with no live surface on it — one object, so identity holds. */
const EMPTY: LiveTableRows = {}

// Re-exported so a consumer names the hook it calls rather than the module the shape
// happens to be declared in; it lives beside `mergeRows` because that is what builds one.
export type { LiveTableRows }

async function fetchSource(source: TableSource): Promise<string[][]> {
  if (source === 'calls') {
    const res = await api.calls.list(DEMO_VS_CUSTOMER_ID, { limit: LIVE_TABLE_LIMIT })
    return callRows(res.events)
  }
  const res = await api.sms.list(DEMO_VS_CUSTOMER_ID, { limit: LIVE_TABLE_LIMIT })
  return smsRows(res.messages)
}

/**
 * Poll `sources` and return their cells, newest record first.
 *
 * `sources` may be rebuilt on every render — it is derived from a config the editor edits
 * under the caller's hands — so the poll is keyed on the *names* rather than on the
 * array. A caller whose sources have not changed never restarts the interval.
 */
export function useLiveTables(
  sources: TableSource[],
  pollMs: number = LIVE_TABLE_POLL_MS,
): LiveTableRows {
  const key = useMemo(() => [...new Set(sources)].sort().join(','), [sources])
  const wanted = useMemo(() => (key === '' ? [] : (key.split(',') as TableSource[])), [key])
  const [rows, setRows] = useState<LiveTableRows>({})
  // Read once per mount, like the editor's own flag: a toggle that could change under a
  // running page would have to decide what happens to the rows already on the surface.
  //
  // `import.meta.env.DEV` is spelled out at both uses, redundantly with the check inside
  // `detectSimTables`, because that is what makes the simulation *tree-shakeable*: Vite
  // substitutes the literal `false` in a production build, both references fall in dead
  // branches, and `lib/simTables.ts` leaves the chunk entirely. Dev-only otherwise says
  // only when the code runs, never whether it ships — which is how a page nobody can put
  // it on still pays for a hundred made-up call records.
  const [sim] = useState(() => import.meta.env.DEV && detectSimTables())
  const simulated = useMemo(() => {
    if (!import.meta.env.DEV || !sim || wanted.length === 0) return null
    const out: LiveTableRows = {}
    for (const source of wanted) out[source] = simFeedRows(source)
    return out
  }, [sim, wanted])

  useEffect(() => {
    // Simulated rows are the whole answer, so there is nothing to ask for and nothing to
    // poll: an interval here would spend a request every few seconds on records that are
    // thrown away, and the first reply would replace the full table with the two calls a
    // development database holds, which is the state `?sim=1` exists to get out of.
    if (sim || wanted.length === 0) return
    let cancelled = false

    const refresh = async () => {
      // A hidden tab is nobody watching. Polling it spends a request per interval on a
      // surface that is not on screen, and the visibility listener below catches the tab
      // up the moment it comes back.
      if (typeof document !== 'undefined' && document.hidden) return
      const fetched = await Promise.all(
        wanted.map(async source => {
          try {
            return [source, await fetchSource(source)] as const
          } catch (e) {
            // Keep whatever is on the surface. A projected table has no error state to
            // render into — it is lettering on a notepad — and blanking it mid-call reads
            // as the call having vanished rather than as one request having failed.
            logger.warn('Live table refresh failed', { source, error: String(e) })
            return [source, null] as const
          }
        }),
      )
      if (cancelled) return
      setRows(prev => mergeRows(prev, fetched))
    }

    void refresh()
    const timer = setInterval(() => void refresh(), pollMs)
    const onVisibility = () => {
      if (!document.hidden) void refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [wanted, pollMs, sim])

  // Derived rather than cleared from the effect: a page with no live surface on it is the
  // common case, and the last page's rows must not be handed to it. `EMPTY` is a constant
  // so that answer is identity-stable, which is what the caller's memo needs — and the
  // simulated answer is memoized on the same names for exactly that reason.
  if (simulated) return simulated
  return wanted.length === 0 ? EMPTY : rows
}
