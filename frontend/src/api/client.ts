import { demoApi } from './demoClient'
import { liveApi } from './liveClient'

export type * from './types'

/**
 * The app's data layer. Every hook calls this and neither knows nor cares which it got:
 * the in-memory demo by default, the real backend under `VITE_LIVE_BACKEND=true`.
 */
export const api = import.meta.env.VITE_LIVE_BACKEND === 'true' ? liveApi : demoApi
