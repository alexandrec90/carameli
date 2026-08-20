/**
 * Global error capture — the bridge between an uncaught browser error and the
 * server-side log file.
 *
 * It lives here rather than inline in `main.tsx` so the shaping of an entry is a pure
 * function a test can call. What that shaping gets wrong is invisible in the browser,
 * where the console prints the stack whatever the handler does, and only shows up
 * days later in a log file that turns out not to name the caller.
 */

import { logger } from './logger'

/**
 * Cap on a captured stack. A stack is unbounded in principle — a runaway recursion
 * produces megabytes of it — and this rides a POST that fires on every error, so the
 * frame that names the caller has to be paid for out of a fixed budget. The first
 * frames are the ones that identify the fault, so the cut is at the tail.
 */
export const STACK_CHARS = 2000

/**
 * `err.stack`, bounded, when there is one.
 *
 * The stack is the part worth shipping. Message, file, line and column say a
 * destructure threw inside `bubbleShape.ts`; only the stack says which caller handed it
 * the bad value, which is the difference between a log entry someone can act on and one
 * that sends them back to the browser to reproduce it.
 *
 * Both callers hand it a value the spec types as `any`: `ErrorEvent.error` is null for
 * a cross-origin script error, and a promise can reject with a string, so the guard is
 * load-bearing rather than defensive typing.
 */
export function stackOf(err: unknown): string | undefined {
  return err instanceof Error && err.stack ? err.stack.slice(0, STACK_CHARS) : undefined
}

/** The context object logged for an uncaught error. Exported for its test. */
export function uncaughtErrorContext(event: ErrorEvent): Record<string, unknown> {
  return {
    message: event.message,
    source: event.filename,
    line: event.lineno,
    col: event.colno,
    stack: stackOf(event.error),
  }
}

/** The context object logged for an unhandled rejection. Exported for its test. */
export function rejectionContext(reason: unknown): Record<string, unknown> {
  return { reason: String(reason), stack: stackOf(reason) }
}

/**
 * Subscribe the logger to `error` and `unhandledrejection`. Called once from
 * `main.tsx`, before the app renders, so an error thrown during the first render is
 * captured too.
 */
export function installGlobalErrorHandlers(target: Window = window): void {
  target.addEventListener('error', event => {
    logger.error('Uncaught error', uncaughtErrorContext(event))
  })
  target.addEventListener('unhandledrejection', event => {
    logger.error('Unhandled promise rejection', rejectionContext(event.reason))
  })
}
