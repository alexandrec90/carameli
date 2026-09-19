/**
 * Give the test environment a working `localStorage` on Node versions that shadow
 * happy-dom's.
 *
 * Node gained a built-in Web Storage implementation in v22.4. It defines `localStorage`
 * as a getter on `globalThis`, and without `--localstorage-file` that getter returns
 * `undefined`. Vitest's happy-dom environment then finds the key already present and
 * leaves it alone, so `'localStorage' in globalThis` is `true` while `localStorage` is
 * `undefined` — and a test that stores a value dies on `Cannot read properties of
 * undefined (reading 'setItem')`. It was a workstation-only failure while CI ran Node 20,
 * which made it read as a broken test rather than a broken environment; CI is on 24 now,
 * so this file is what keeps the storage tests green there as well.
 *
 * `--no-experimental-webstorage` fixes it and is still not what this does: a flag is a
 * claim about which Node is running, and the pin has already moved once. A value check
 * survives the next move — install a substitute only when the environment failed to
 * provide one, which is a no-op everywhere the environment works.
 */

/** An in-memory `Storage`, sufficient for the API surface a test actually uses. */
export function createMemoryStorage(): Storage {
  const entries = new Map<string, string>()
  return {
    get length() {
      return entries.size
    },
    key(index: number): string | null {
      return [...entries.keys()][index] ?? null
    },
    getItem(key: string): string | null {
      return entries.get(String(key)) ?? null
    },
    setItem(key: string, value: string): void {
      entries.set(String(key), String(value))
    },
    removeItem(key: string): void {
      entries.delete(String(key))
    },
    clear(): void {
      entries.clear()
    },
  }
}

/** Whether `target[name]` is a usable `Storage` rather than a shadowing `undefined`. */
export function storageWorks(target: object, name: string): boolean {
  const value = (target as Record<string, unknown>)[name]
  return typeof value === 'object' && value !== null
    && typeof (value as Storage).setItem === 'function'
}

/**
 * Install a memory `Storage` at `target[name]` if — and only if — what is there does not
 * work. Returns whether it installed one, so the test can assert both halves.
 *
 * `defineProperty` rather than assignment: Node's is an accessor with no setter, and a
 * plain assignment to it is silently dropped in sloppy mode and throws in strict.
 */
export function installStorage(target: object, name: string): boolean {
  if (storageWorks(target, name)) return false
  Object.defineProperty(target, name, {
    value: createMemoryStorage(),
    configurable: true,
    writable: true,
    enumerable: true,
  })
  return true
}

for (const name of ['localStorage', 'sessionStorage']) {
  installStorage(globalThis, name)
}
