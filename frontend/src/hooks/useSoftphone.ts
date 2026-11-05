import { useDemoSoftphone } from './useDemoSoftphone'
import { useLiveSoftphone } from './useLiveSoftphone'

export type { CallStatus, UseSoftphoneResult } from '../lib/softphone'

/** The telephone: a scripted one by default, a real SIP phone in a live build. */
export const useSoftphone =
  import.meta.env.VITE_LIVE_BACKEND === 'true' ? useLiveSoftphone : useDemoSoftphone
