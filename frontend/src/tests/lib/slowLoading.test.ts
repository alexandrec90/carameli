import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_SLOW_MS,
  SLOW_LOAD_MS,
  detectSlowLoading,
  resolveSlowFlag,
  slowLoad,
  slowLoaderDelay,
} from '../../lib/slowLoading'

describe('resolveSlowFlag', () => {
  it('is off with nothing asked for and nothing remembered', () => {
    expect(resolveSlowFlag(null, null)).toEqual({ ms: 0, storedFlag: null })
  })

  it('turns on from 1, at the default hold', () => {
    expect(resolveSlowFlag('1', null)).toEqual({ ms: SLOW_LOAD_MS, storedFlag: String(SLOW_LOAD_MS) })
  })

  it('turns off from 0 and forgets what was remembered', () => {
    expect(resolveSlowFlag('0', '1000')).toEqual({ ms: 0, storedFlag: null })
  })

  it('takes any other whole number as milliseconds', () => {
    expect(resolveSlowFlag('2500', null)).toEqual({ ms: 2500, storedFlag: '2500' })
  })

  it('caps a duration so a stray digit cannot wedge the app', () => {
    expect(resolveSlowFlag('900000', null)).toEqual({ ms: MAX_SLOW_MS, storedFlag: String(MAX_SLOW_MS) })
  })

  it('falls back to the remembered value when the query says nothing usable', () => {
    expect(resolveSlowFlag(null, '2500').ms).toBe(2500)
    expect(resolveSlowFlag('', '2500').ms).toBe(2500)
    expect(resolveSlowFlag('yes', '2500').ms).toBe(2500)
    expect(resolveSlowFlag('-5', '2500').ms).toBe(2500)
    expect(resolveSlowFlag('1.5', '2500').ms).toBe(2500)
  })

  it('stores the resolved duration, so re-reading it is a fixed point', () => {
    const first = resolveSlowFlag('1', null)
    expect(resolveSlowFlag(null, first.storedFlag)).toEqual(first)
  })

  it('ignores an unusable remembered value rather than holding forever', () => {
    expect(resolveSlowFlag(null, 'yes')).toEqual({ ms: 0, storedFlag: null })
  })
})

describe('detectSlowLoading', () => {
  const FLAG = 'loading:slow'
  const visit = (search: string) => window.history.replaceState(null, '', `/${search}`)

  afterEach(() => {
    visit('')
    window.localStorage.removeItem(FLAG)
    vi.restoreAllMocks()
  })

  it('is off with nothing asked for and nothing remembered', () => {
    expect(detectSlowLoading()).toBe(0)
    expect(window.localStorage.getItem(FLAG)).toBeNull()
  })

  it('turns on from ?slow=1 and remembers it for the next page', () => {
    visit('?slow=1')
    expect(detectSlowLoading()).toBe(SLOW_LOAD_MS)
    expect(window.localStorage.getItem(FLAG)).toBe(String(SLOW_LOAD_MS))

    visit('')
    expect(detectSlowLoading()).toBe(SLOW_LOAD_MS)
  })

  it('takes a duration from ?slow=<ms>', () => {
    visit('?slow=2500')
    expect(detectSlowLoading()).toBe(2500)
    expect(window.localStorage.getItem(FLAG)).toBe('2500')
  })

  it('turns off from ?slow=0 and forgets', () => {
    window.localStorage.setItem(FLAG, '1000')
    visit('?slow=0')
    expect(detectSlowLoading()).toBe(0)
    expect(window.localStorage.getItem(FLAG)).toBeNull()
  })

  it('keeps its own flag apart from the simulation ones', () => {
    visit('?sim=1&smsSim=1&callSim=1')
    expect(detectSlowLoading()).toBe(0)
    expect(window.localStorage.getItem(FLAG)).toBeNull()
  })

  it('still honours the query when the flag cannot be persisted', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    visit('?slow=1')
    expect(detectSlowLoading()).toBe(SLOW_LOAD_MS)
  })
})

describe('slowLoaderDelay', () => {
  it('keeps the debounce while the brake is off', () => {
    expect(slowLoaderDelay(400, 0)).toBe(400)
  })

  it('drops the debounce while the brake is on, so the screen paints at once', () => {
    expect(slowLoaderDelay(400, 1000)).toBe(0)
  })
})

describe('slowLoad', () => {
  afterEach(() => vi.useRealTimers())

  it('is the identity while the brake is off, allocating no second promise', () => {
    const promise = Promise.resolve('skin')
    expect(slowLoad(promise, 0)).toBe(promise)
  })

  it('holds an already-settled promise for the full duration', async () => {
    vi.useFakeTimers()
    const settled = vi.fn()
    void slowLoad(Promise.resolve('skin'), 1000).then(settled)

    await vi.advanceTimersByTimeAsync(999)
    expect(settled).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toHaveBeenCalledWith('skin')
  })

  it('waits for a slow promise past the brake rather than resolving early', async () => {
    vi.useFakeTimers()
    let release: (value: string) => void = () => {}
    const slow = new Promise<string>(resolve => { release = resolve })
    const settled = vi.fn()
    void slowLoad(slow, 1000).then(settled)

    await vi.advanceTimersByTimeAsync(2000)
    expect(settled).not.toHaveBeenCalled()

    release('skin')
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toHaveBeenCalledWith('skin')
  })

  it('passes a rejection through instead of swallowing it behind the brake', async () => {
    await expect(slowLoad(Promise.reject(new Error('chunk failed')), 1)).rejects.toThrow('chunk failed')
  })
})
