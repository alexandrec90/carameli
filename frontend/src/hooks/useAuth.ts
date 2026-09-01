import { useState, useEffect } from 'react'

const BASE = import.meta.env.VITE_API_BASE_URL ?? ''

/**
 * The one in-flight session request, shared by every caller.
 *
 * Two separate problems are solved by there being exactly one of these, and both of them
 * looked like something else first.
 *
 * **It has to be startable without rendering.** `SkinProvider` does not render its
 * children until the skin's chunk has downloaded and executed (`skins/context.tsx` —
 * `if (!skin) return <loading screen>`), and `App` does not render *its* children until
 * this request comes back. So while the fetch lived in a hook inside `App`, the two waits
 * ran strictly one after the other: the browser finished the skin — 258 kB as one chunk in
 * a build, ~150 modules in dev — and only then put a request on the wire that had never
 * needed anything from it. `main.tsx` calls {@link startSession} before
 * `createRoot().render()`, so the round trip overlaps the skin load instead of following
 * it. That is not a dev-only saving: the serialization shipped.
 *
 * **"Before render" is not "immediately", and in dev it is nowhere near it.** A traced
 * load on 2026-08-31 put `POST /auth/session` on the wire at **3786 ms**, not at ~800 ms
 * where `main.tsx` itself arrived. ES module semantics are the reason and they are worth
 * knowing before trusting a call placed at the top of an entry file: `main.tsx`'s *body*
 * cannot run until its own static import graph — `App.tsx`, `softphoneContext`,
 * `routes`, and everything those pull — has been fetched and evaluated. Only the skin
 * escapes that, because the registry reaches it through a dynamic `import()`. So the
 * overlap this buys is real and measured (the skin's graph ran to 5.3 s, and the request
 * was answered by 4.3 s, entirely hidden behind it) but it is an overlap with the
 * *skin*, not a head start on the page. Moving it earlier still would mean an inline
 * `<script>` in `index.html`, which is a different trade and has not been made.
 *
 * **And one request means one request.** `React.StrictMode` double-invokes effects in
 * development, so a fetch issued from the effect body ran twice on every load and two
 * POSTs raced to set the session cookie. The usual reading of that is "StrictMode noise",
 * but StrictMode was reporting something true — the effect had no cleanup and was not safe
 * to run twice. Memoizing the promise makes the second call join the first instead of
 * starting another, which is what the effect should always have done.
 */
let session: Promise<void> | null = null

/**
 * Acquire the session, or join the attempt already running.
 *
 * `POST /auth/session` is idempotent and needs no existing credentials (network-level
 * trust model). Calling it directly avoids the `GET /auth/me` probe, which always 401s on
 * first load and puts a "Failed to load resource" error in the console that breaks the E2E
 * smoke tests.
 *
 * Never rejects, and that is load-bearing rather than tidy: the previous
 * `fetch(...).finally(...)` had no rejection handler at all, so an offline load raised an
 * unhandled promise rejection that `installGlobalErrorHandlers` duly captured and logged.
 * A non-OK status is a resolved fetch and is kept; a network-level failure is swallowed
 * *and* drops the memo, so a later mount retries rather than inheriting one dead attempt
 * for the life of the page. Callers gate on completion, not on success — the app renders
 * either way and the API surfaces its own 401s.
 */
export function startSession(): Promise<void> {
  session ??= fetch(`${BASE}/auth/session`, {
    method: 'POST',
    credentials: 'include',
  }).then(
    () => undefined,
    () => {
      session = null
    },
  )
  return session
}

export function useAuth() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    // Guarded rather than fire-and-forget: this is the cleanup whose absence StrictMode
    // was pointing at, and it is what keeps a settled request from calling setState into
    // a mount that has already gone away.
    let cancelled = false
    void startSession().finally(() => {
      if (!cancelled) setReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return { ready }
}
