import { resolve } from 'node:path'

// Where the comic-book editor's Save button writes, and how that path is spelled for the
// two consumers that need different spellings.
//
// **The write target is resolved from `frontend/`, never from the repo root.** The dev
// server does not always have the repo root: `docker-compose` bind-mounts `frontend/`
// alone at `/app`, so a target resolved against `<frontend>/..` becomes `/frontend/…` —
// a path with no directory above it inside the container. That is not a hypothetical:
// every Save from the containerised dev server failed with `ENOENT` on exactly that
// path, and because the toolbar falls back to downloading the file, the editor reported
// nothing and the layout silently stayed on whatever `layoutConfig.ts` already held.
// Resolving from the frontend directory is correct in both trees, since that directory
// is the one thing a frontend dev server is guaranteed to be standing in.

/** The config file, relative to `frontend/` — the spelling the file writer needs. */
export const CONFIG_IN_FRONTEND = 'src/skins/comic-book/editor/layoutConfig.ts'

/**
 * The same file, relative to the repo root — the spelling git wants, since `shipLayout`
 * runs `git add` from there.
 */
export const CONFIG_IN_REPO = `frontend/${CONFIG_IN_FRONTEND}`

/**
 * The absolute file to overwrite, given the directory `vite.config.ts` itself lives in.
 *
 * Takes the frontend directory rather than reading it from `import.meta.url` so the
 * containment property above is a plain function call a test can check, instead of a
 * fact about wherever the test happens to be running from.
 */
export function editorConfigFile(frontendDir: string): string {
  return resolve(frontendDir, CONFIG_IN_FRONTEND)
}
