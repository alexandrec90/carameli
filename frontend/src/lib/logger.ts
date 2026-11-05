import { isBackendOffline } from './backendReachability'
import { shipLog } from './logShipping'

/**
 * Structured frontend logger.
 *
 * In all environments: writes to the browser console.
 * In a live build: also ships entries to the server's log file (`lib/logShipping.ts`).
 */
const record = import.meta.env.VITE_LIVE_BACKEND === 'true' ? shipLog : () => undefined

export const logger = {
  debug(message: string, context?: Record<string, unknown>): void {
    console.debug(`[DEBUG] ${message}`, context ?? '')
    record('debug', message, context)
  },

  info(message: string, context?: Record<string, unknown>): void {
    console.info(`[INFO] ${message}`, context ?? '')
    record('info', message, context)
  },

  warn(message: string, context?: Record<string, unknown>): void {
    console.warn(`[WARN] ${message}`, context ?? '')
    record('warn', message, context)
  },

  error(message: string, context?: Record<string, unknown>): void {
    // Same text, different channel: in a preview with no backend behind the proxy
    // every load failure has one known cause, and painting each one red buries
    // anything that is genuinely wrong. Nothing is hidden and nothing is dropped —
    // and `isBackendOffline()` is never true in a production build.
    if (import.meta.env.VITE_LIVE_BACKEND === 'true' && isBackendOffline()) {
      console.warn(`[ERROR] ${message}`, context ?? '')
    } else {
      console.error(`[ERROR] ${message}`, context ?? '')
    }
    record('error', message, context)
  },
}
