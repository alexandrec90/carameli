import type { LiveTableRows, TableSource } from '../lib/liveTables'
import { useDemoTables } from './useDemoTables'
import { usePolledTables } from './usePolledTables'

// Re-exported so a consumer names the hook it calls rather than the module the shape
// happens to be declared in.
export type { LiveTableRows }

/**
 * Call and SMS records for whatever is drawing them, newest first: the made-up records by
 * default, a poll of the real ones in a live build.
 */
export const useLiveTables: (sources: TableSource[]) => LiveTableRows =
  import.meta.env.VITE_LIVE_BACKEND === 'true' ? usePolledTables : useDemoTables
