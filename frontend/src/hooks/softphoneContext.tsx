import React, { createContext, useContext } from 'react'

import { useSoftphone } from './useSoftphone'
import type { UseSoftphoneResult } from './useSoftphone'

const SoftphoneContext = createContext<UseSoftphoneResult | null>(null)

/**
 * One softphone for the whole app.
 *
 * The registration is a single SIP AOR, so a second `useSoftphone()` is not a second
 * copy of some state — it is a second device registering the same extension, and the
 * SBC then forks an inbound call to both and lets whichever answers first win. That is
 * why the projected number pad reads this context rather than calling the hook: the
 * pad on a picture and the /softphone page are two faces of the same telephone.
 *
 * Mounting the provider costs nothing at load: SIP.js is still imported dynamically
 * inside the hook's registration path, so nothing pulls it until someone dials.
 */
export function SoftphoneProvider({ children }: { children: React.ReactNode }) {
  const softphone = useSoftphone()
  return <SoftphoneContext.Provider value={softphone}>{children}</SoftphoneContext.Provider>
}

/** The app's single softphone. Throws outside the provider rather than registering a second one. */
export function useSharedSoftphone(): UseSoftphoneResult {
  const softphone = useContext(SoftphoneContext)
  if (!softphone) {
    throw new Error('useSharedSoftphone must be called inside <SoftphoneProvider>')
  }
  return softphone
}
