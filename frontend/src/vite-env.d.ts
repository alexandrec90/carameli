/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * `'true'` builds the real app; anything else, or nothing, builds the UI demo. Read when
   * Vite starts, so a URL or a running page cannot change it.
   *
   * Always test it inline, as `import.meta.env.VITE_LIVE_BACKEND === 'true'`. A shared
   * constant reads better and does not work: see "To turn it on" in `frontend/CLAUDE.md`.
   */
  readonly VITE_LIVE_BACKEND?: string
}
