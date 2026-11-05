import { useMemo } from 'react'

import type { LiveTableRows, TableSource } from '../lib/liveTables'
import { simFeedRows } from '../lib/simTables'

/** The answer for a page with no live surface on it — one object, so identity holds. */
const EMPTY: LiveTableRows = {}

/**
 * The cells of `sources`, from the made-up records in `lib/simTables.ts`. Nothing is
 * fetched and nothing polls.
 *
 * `sources` may be rebuilt on every render — it is derived from a config the editor edits
 * under the caller's hands — so the answer is keyed on the *names* rather than on the
 * array, and an unchanged set of names hands back the identical object.
 */
export function useDemoTables(sources: TableSource[]): LiveTableRows {
  const key = useMemo(() => [...new Set(sources)].sort().join(','), [sources])
  return useMemo(() => {
    if (key === '') return EMPTY
    const out: LiveTableRows = {}
    for (const source of key.split(',') as TableSource[]) out[source] = simFeedRows(source)
    return out
  }, [key])
}
