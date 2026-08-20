import { describe, expect, it, vi } from 'vitest'

import {
  STACK_CHARS,
  installGlobalErrorHandlers,
  rejectionContext,
  stackOf,
  uncaughtErrorContext,
} from '../../lib/errorReporting'
import { logger } from '../../lib/logger'

/** An Error whose stack is ours rather than the runtime's, so assertions are exact. */
function withStack(stack: string): Error {
  const err = new Error('boom')
  err.stack = stack
  return err
}

describe('stackOf', () => {
  it('returns the stack of a real Error', () => {
    expect(stackOf(withStack('Error: boom\n  at ringPoints'))).toBe(
      'Error: boom\n  at ringPoints',
    )
  })

  it('truncates a runaway stack to the cap, keeping the leading frames', () => {
    const deep = `Error: boom\n${'  at recurse\n'.repeat(5000)}`
    const got = stackOf(withStack(deep))
    expect(got).toHaveLength(STACK_CHARS)
    // The frames that name the fault are at the top, so the tail is what gets cut.
    expect(got?.startsWith('Error: boom\n  at recurse')).toBe(true)
  })

  it('returns undefined for the non-Errors the DOM actually hands it', () => {
    // ErrorEvent.error is null for a cross-origin script error, and a promise may
    // reject with anything at all.
    expect(stackOf(null)).toBeUndefined()
    expect(stackOf(undefined)).toBeUndefined()
    expect(stackOf('just a string')).toBeUndefined()
    expect(stackOf({ stack: 'a lookalike' })).toBeUndefined()
  })

  it('returns undefined for an Error carrying no stack', () => {
    const err = new Error('boom')
    err.stack = undefined
    expect(stackOf(err)).toBeUndefined()
  })
})

describe('uncaughtErrorContext', () => {
  // The regression: the handler used to log message/source/line/col only, so the log
  // file said a destructure threw in bubbleShape.ts and never which caller fed it.
  it('carries the call stack alongside the location', () => {
    const event = new ErrorEvent('error', {
      message: "Cannot destructure property 'mod' of 'SHAPES[type]'",
      filename: 'http://localhost:5173/src/skins/comic-book/bubbleShape.ts',
      lineno: 142,
      colno: 10,
      error: withStack('TypeError\n  at ringPoints\n  at useBubbleMorph\n  at PanelBubble'),
    })
    expect(uncaughtErrorContext(event)).toEqual({
      message: "Cannot destructure property 'mod' of 'SHAPES[type]'",
      source: 'http://localhost:5173/src/skins/comic-book/bubbleShape.ts',
      line: 142,
      col: 10,
      stack: 'TypeError\n  at ringPoints\n  at useBubbleMorph\n  at PanelBubble',
    })
  })

  it('still logs the location when there is no Error object to take a stack from', () => {
    const event = new ErrorEvent('error', { message: 'Script error.', lineno: 0 })
    expect(uncaughtErrorContext(event)).toMatchObject({
      message: 'Script error.',
      stack: undefined,
    })
  })
})

describe('rejectionContext', () => {
  it('stringifies the reason and takes its stack when it is an Error', () => {
    expect(rejectionContext(withStack('Error: nope\n  at fetchThing'))).toEqual({
      reason: 'Error: boom',
      stack: 'Error: nope\n  at fetchThing',
    })
  })

  it('stringifies a non-Error reason and reports no stack', () => {
    expect(rejectionContext('plain string')).toEqual({
      reason: 'plain string',
      stack: undefined,
    })
  })
})

describe('installGlobalErrorHandlers', () => {
  it('logs an uncaught error dispatched on the target', () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {})
    try {
      installGlobalErrorHandlers(window)
      window.dispatchEvent(
        new ErrorEvent('error', { message: 'boom', error: withStack('Error: boom\n  at f') }),
      )
      expect(spy).toHaveBeenCalledWith(
        'Uncaught error',
        expect.objectContaining({ message: 'boom', stack: 'Error: boom\n  at f' }),
      )
    } finally {
      spy.mockRestore()
    }
  })
})
