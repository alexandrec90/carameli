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

async function flush(): Promise<void> {
  flushTimer = null
  if (queue.length === 0) return
  const batch = queue.splice(0, queue.length)
  try {
    await fetch(`${API_BASE}/vg/1.0.0/frontend-logs`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: batch }),
      // Use keepalive so logs still ship on page unload
      keepalive: true,
    })
  } catch {
    // Silently swallow — avoid infinite logging loops
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
    console.error(`[ERROR] ${message}`, context ?? '')
    record('error', message, context)
  },
}
