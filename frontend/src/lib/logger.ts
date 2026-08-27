/**
 * Structured frontend logger.
 *
 * In all environments: writes to browser console.
 * Always: ships batched entries to POST /vg/1.0.0/frontend-logs so they
 * appear in the server-side rotating log file alongside backend events.
 *
 * Log format that reaches the file:
 *   [FRONTEND] <message> | context={...}
 */

import { isBackendOffline } from './backendReachability'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

type LogLevel = 'debug' | 'info' | 'warn' | 'error'

interface LogEntry {
  level: LogLevel
  message: string
  context?: Record<string, unknown>
}

// Queue entries and flush every 2 s (or immediately on error)
const queue: LogEntry[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

function scheduleFlush(): void {
  if (flushTimer !== null) return
  flushTimer = setTimeout(flush, 2000)
}

/**
 * A sink that has refused this many posts in a row is down rather than flaky, so
 * stop posting to it. Without a stop, a page whose backend is absent turns every
 * log line into another failed request — including the lines *about* failed
 * requests, which is most of the noise a UI-only preview reports.
 */
const MAX_CONSECUTIVE_SHIP_FAILURES = 3
let shipFailures = 0

function shippingStopped(): boolean {
  return shipFailures >= MAX_CONSECUTIVE_SHIP_FAILURES || isBackendOffline()
}

async function flush(): Promise<void> {
  flushTimer = null
  if (queue.length === 0) return
  if (shippingStopped()) {
    // Drop rather than accumulate: nothing is going to drain this.
    queue.length = 0
    return
  }
  const batch = queue.splice(0, queue.length)
  try {
    const res = await fetch(`${API_BASE}/vg/1.0.0/frontend-logs`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: batch }),
      // Use keepalive so logs still ship on page unload
      keepalive: true,
    })
    shipFailures = res.ok ? 0 : shipFailures + 1
  } catch {
    // Silently swallow — avoid infinite logging loops
    shipFailures += 1
  }
}

function record(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  queue.push({ level, message, context })
  if (level === 'error') {
    // Flush errors immediately
    flush()
  } else {
    scheduleFlush()
  }
}

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
    if (isBackendOffline()) {
      console.warn(`[ERROR] ${message}`, context ?? '')
    } else {
      console.error(`[ERROR] ${message}`, context ?? '')
    }
    record('error', message, context)
  },
}
