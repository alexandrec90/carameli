/**
 * The dev server's half of comic-book asset sync: art appears in the editor's picture
 * dropdown because it is on disk, not because somebody remembered a step.
 *
 * Adding a picture used to be three acts — encode the master, register the export in
 * `PANEL_ASSETS`, place it in a panel — of which only the third is authoring.
 * `scripts/encode-comic-art.py` folded the first two into one command, and this folds
 * that command into saving the file: drop a PNG into `assets-src/comic-book/` and the
 * running dev server encodes it, registers it, and the dropdown carries it on the reload
 * the manifest write triggers. Dropping a `.webp` straight into `public/comic-book/`
 * registers it too, and deleting one takes its line back out.
 *
 * Three things this deliberately does not do:
 *
 * - **It never places a picture.** Which panel draws what is authoring work, done in the
 *   editor and saved to `layoutConfig.ts`. A picture is legitimately unplaced for a while
 *   — `assets.ts` is in `NON_LOADING_SOURCES`, so an offered-but-undrawn export costs no
 *   page budget and fails nothing.
 * - **It never runs in a build.** The plugin is `apply: 'serve'`, and `sharp` is reached
 *   through a dynamic import, so a production build neither watches nor loads it.
 * - **It never re-encodes.** An existing `.webp` is left alone, exactly as the script's
 *   default does; re-encoding on every restart would compound loss on files nobody
 *   changed. `scripts/encode-comic-art.py --force` is still how you redo one.
 *
 * The reconciliation itself is pure and lives in `comicAssets.ts`; what is here is the
 * filesystem and the watcher, injected as {@link AssetSyncIo} so the wiring is testable
 * without a disk or a running server.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type { Plugin } from 'vite'

import {
  ASSET_DIR_IN_FRONTEND,
  EXPORT_MAX_EDGE,
  EXPORT_QUALITY,
  MANIFEST_IN_FRONTEND,
  MASTERS_DIR_IN_FRONTEND,
  exportNameFor,
  isMaster,
  mastersNeedingExport,
  syncManifest,
} from './comicAssets.ts'

/** Everything {@link reconcileAssets} touches outside itself. */
export interface AssetSyncIo {
  /** File names in `public/comic-book/`, or `[]` when the directory is unreadable. */
  listExports(): string[]
  /** File names in `assets-src/comic-book/`. */
  listMasters(): string[]
  readManifest(): string
  writeManifest(text: string): void
  /** Encode one master to one export, both named by file rather than by path. */
  encode(masterName: string, exportName: string): Promise<void>
  log(message: string): void
  warn(message: string): void
}

/** What one pass changed, for the caller to report. */
export interface AssetSyncResult {
  encoded: string[]
  added: string[]
  removed: string[]
}

/**
 * Encode every master that has no export, then level `PANEL_ASSETS` with the directory.
 *
 * The order is load-bearing: a master encoded in this pass has to be in the listing the
 * manifest is synced against, or its line would not appear until the next event.
 *
 * A failed encode is reported and skipped rather than thrown. The usual cause is a file
 * still being written — a drag-and-drop of a 6 MB PNG lands as an `add` well before the
 * last byte — and the next pass picks it up, so failing the dev server over it would turn
 * a retry into a restart.
 */
export async function reconcileAssets(io: AssetSyncIo): Promise<AssetSyncResult> {
  const encoded: string[] = []
  for (const master of mastersNeedingExport(io.listMasters(), io.listExports())) {
    const exportName = exportNameFor(master)
    try {
      await io.encode(master, exportName)
      encoded.push(exportName)
      io.log(`encoded ${master} -> ${exportName}`)
    } catch (err) {
      io.warn(`could not encode ${master} (${String(err)}); will retry on the next change`)
    }
  }

  const sync = syncManifest(io.readManifest(), io.listExports())
  if (sync.changed) {
    io.writeManifest(sync.text)
    const parts = [
      sync.added.length > 0 ? `offered ${sync.added.join(', ')}` : '',
      sync.removed.length > 0 ? `dropped ${sync.removed.join(', ')}` : '',
    ].filter(Boolean)
    io.log(parts.join('; '))
  }

  return { encoded, added: sync.added, removed: sync.removed }
}

/** Names in `dir`, or `[]` when it does not exist — an absent directory is not an error. */
function listDir(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => entry.name)
  } catch {
    return []
  }
}

/**
 * The real {@link AssetSyncIo}, rooted at `frontendDir`.
 *
 * Resolved from `frontend/` rather than the repo root for the reason `editorConfigPath.ts`
 * spells out: `docker-compose` bind-mounts that directory alone, so nothing above it is a
 * path inside the container.
 */
export function nodeAssetSyncIo(
  frontendDir: string,
  logger: Pick<Console, 'log' | 'warn'>,
): AssetSyncIo {
  const exportsDir = resolve(frontendDir, ASSET_DIR_IN_FRONTEND)
  const mastersDir = resolve(frontendDir, MASTERS_DIR_IN_FRONTEND)
  const manifest = resolve(frontendDir, MANIFEST_IN_FRONTEND)

  return {
    listExports: () => listDir(exportsDir),
    listMasters: () => listDir(mastersDir).filter(isMaster),
    readManifest: () => readFileSync(manifest, 'utf8'),
    writeManifest: text => writeFileSync(manifest, text, 'utf8'),
    encode: async (masterName, exportName) => {
      // Dynamic so a build — or a tree whose node_modules predates sharp — never loads it.
      const { default: sharp } = await import('sharp')
      await sharp(join(mastersDir, masterName))
        .resize({
          width: EXPORT_MAX_EDGE,
          height: EXPORT_MAX_EDGE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: EXPORT_QUALITY })
        .toFile(join(exportsDir, exportName))
    },
    log: message => logger.log(`[comic-assets] ${message}`),
    warn: message => logger.warn(`[comic-assets] ${message}`),
  }
}

/**
 * How long to sit on a burst of watcher events before reconciling, in ms.
 *
 * Long enough that `scripts/encode-comic-art.py` — which writes the export and then the
 * manifest line, with its own `--label` — always finishes first, so a run of the script
 * never races this into a derived label. Also collapses the several events a multi-file
 * copy produces into one pass.
 */
export const SYNC_DEBOUNCE_MS = 600

/** True when a watcher path is one this plugin reconciles on. */
export function isWatched(path: string): boolean {
  const slashed = path.replace(/\\/g, '/')
  return (
    slashed.includes(`/${ASSET_DIR_IN_FRONTEND}/`) || slashed.includes(`/${MASTERS_DIR_IN_FRONTEND}/`)
  )
}

/**
 * Dev-only plugin: reconcile once at startup, then on every add/unlink under either
 * comic-book asset directory.
 *
 * Startup matters as much as the events do — it is what catches art added while the
 * server was down, which is most of it.
 */
export function comicAssetsPlugin(frontendDir: string): Plugin {
  return {
    name: 'comic-assets',
    apply: 'serve',
    configureServer(server) {
      const io = nodeAssetSyncIo(frontendDir, {
        log: message => server.config.logger.info(message),
        warn: message => server.config.logger.warn(message),
      })

      let pending: ReturnType<typeof setTimeout> | undefined
      let running = false
      const pass = () => {
        if (running) return schedule()
        running = true
        void reconcileAssets(io)
          .catch((err: unknown) => io.warn(`sync failed: ${String(err)}`))
          .finally(() => {
            running = false
          })
      }
      const schedule = () => {
        if (pending) clearTimeout(pending)
        pending = setTimeout(pass, SYNC_DEBOUNCE_MS)
      }

      pass()
      for (const event of ['add', 'unlink'] as const) {
        server.watcher.on(event, path => {
          if (isWatched(path)) schedule()
        })
      }
    },
  }
}
