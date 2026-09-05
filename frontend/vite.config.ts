/// <reference types="vitest" />
import { execFile } from 'node:child_process'
import type { ExecFileException } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createLogger, defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { configDefaults } from 'vitest/config'

import { comicAssetsPlugin } from './comicAssetsWatch.ts'
import { resolveDevWatch } from './devWatchPolicy.ts'
import { CONFIG_IN_REPO, editorConfigFile } from './editorConfigPath.ts'
import { quietProxyErrors } from './proxyErrorPolicy.ts'
import { shipLayout } from './shipLayout.ts'
import type { Run } from './shipLayout.ts'

const rootDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(rootDir, '..')

/** Repo-relative because git wants it that way — see `editorConfigPath.ts`. */
const CONFIG_PATH = CONFIG_IN_REPO

/** A serialized config is a few tens of KB; anything past this is not one. */
const MAX_BODY = 4_000_000

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((done, fail) => {
    let body = ''
    req.on('data', (chunk: Buffer | string) => {
      body += chunk
      if (body.length > MAX_BODY) fail(new Error('payload too large'))
    })
    req.on('end', () => done(body))
    req.on('error', fail)
  })
}

/**
 * The one validation both endpoints share: the body must carry a string that looks like
 * a serialized layout. A client-supplied *path* is never read, so neither endpoint can
 * be coerced into writing somewhere else.
 */
function parsePayload(body: string): { content: string; summary: string } {
  const parsed = JSON.parse(body) as { content?: unknown; summary?: unknown }
  if (typeof parsed.content !== 'string' || !parsed.content.includes('PANEL_IMG_TRANSFORMS')) {
    throw new Error('Invalid config payload')
  }
  return {
    content: parsed.content,
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
  }
}

/**
 * Spawns `git`/`gh` at the repo root with a fixed argv and **no shell**, so a typed
 * summary reaching the commit subject is an argument rather than something a shell
 * could read as syntax.
 */
const runInRepo: Run = (cmd, args) =>
  new Promise(done => {
    execFile(
      cmd,
      [...args],
      { cwd: repoRoot, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (err: ExecFileException | null, stdout: string, stderr: string) => {
        const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0
        done({ code, stdout, stderr: stderr || (err ? err.message : '') })
      },
    )
  })

/**
 * Dev-only middleware behind the comic-book layout editor's two write buttons.
 * Registered via `configureServer` under `apply: 'serve'`, so it exists only in the dev
 * server and is never part of a production build.
 *
 * - **Save** overwrites the editor's source-of-truth config with the verbatim TS body.
 * - **Ship** does that and then hands the file to `shipLayout`, which branches, commits,
 *   pushes and opens or updates a PR — see that module's header for why the browser
 *   cannot be asked to know which of the three trees it is pointed at.
 *
 * The write target comes from `editorConfigFile(rootDir)` — resolved from `frontend/`,
 * not from `repoRoot` — because the repo root is not mounted in the container that
 * serves this dev server. `repoRoot` stays the cwd for git, which is only reachable in a
 * tree that has one.
 */
function comicEditorPlugin(): Plugin {
  const target = editorConfigFile(rootDir)
  return {
    name: 'comic-editor',
    apply: 'serve',
    configureServer(server) {
      const fail = (res: { statusCode: number; end: (body?: string) => void }, code: number, what: string, err: unknown) => {
        server.config.logger.error(`[comic-editor] ${what}: ${String(err)}`)
        res.statusCode = code
        res.end(what)
      }

      server.middlewares.use('/__comic-editor/save', (req, res, next) => {
        if (req.method !== 'POST') return next()
        readBody(req)
          .then(body => writeFile(target, parsePayload(body).content, 'utf8'))
          .then(() => {
            res.statusCode = 204
            res.end()
          })
          .catch(err => fail(res, 400, 'save failed', err))
      })

      server.middlewares.use('/__comic-editor/ship', (req, res, next) => {
        if (req.method !== 'POST') return next()
        readBody(req)
          .then(async body => {
            const { content, summary } = parsePayload(body)
            await writeFile(target, content, 'utf8')
            return shipLayout({ run: runInRepo, file: CONFIG_PATH, now: () => new Date() }, summary)
          })
          .then(outcome => {
            server.config.logger.info(`[comic-editor] ship: ${outcome.message}`)
            res.statusCode = outcome.ok ? 200 : 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(outcome))
          })
          .catch(err => fail(res, 400, 'ship failed', err))
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // Load .env / .env.local so the proxy target is available even when
  // VITE_PROXY_TARGET is not injected via docker-compose environment:.
  // Priority: process.env (docker-compose) > .env file > local-dev fallback.
  const fileEnv = loadEnv(mode, process.cwd(), '')
  const backendUrl =
    process.env.VITE_PROXY_TARGET ||
    fileEnv.VITE_PROXY_TARGET ||
    'http://127.0.0.1:8000'

  return {
    // comicAssetsPlugin keeps the editor's picture dropdown level with the served
    // directory while the server runs — art dropped in appears without a script or a
    // restart. ./comicAssetsWatch.ts.
    plugins: [react(), comicEditorPlugin(), comicAssetsPlugin(rootDir)],

    // A down backend logs one concise line instead of a stack trace per proxied
    // request — the normal state for host-Vite branch previews. ./proxyErrorPolicy.ts.
    customLogger: quietProxyErrors(createLogger()),
    server: {
      port: 5173,

      // The Docker-hosted MCP browser reaches the dev server via
      // host.docker.internal; Vite's host check blocks it by default.
      allowedHosts: ['host.docker.internal'],

      // Polling vs. native watching, and why the interval is coarse:
      // ./devWatchPolicy.ts.
      watch: resolveDevWatch(process.env),

      // No `warmup:` here, and that is a measured decision rather than an omission —
      // see devWatchPolicy.ts's closing section. Pre-transforming the skin graph looks
      // like the answer to this app's 6.6 s render delay and is not: the delay was
      // traced with the transform cache already warm.
      proxy: {
        // `/api` is the app's own REST surface (`/api/v1/...`). It was missing
        // here for as long as every dev path set VITE_API_BASE_URL to an absolute
        // backend URL and never used the proxy for it — but a host-Vite branch
        // preview forces that base empty, so those calls arrived here and Vite,
        // owning the path, answered its own 404. That reads as a broken endpoint
        // rather than as the absent backend it is.
        '/api': backendUrl,
        '/auth': backendUrl,
        '/vsapi': backendUrl,
        '/vg': backendUrl,
        '/health': backendUrl,
      },
    },
    test: {
      environment: 'happy-dom',
      globals: true,

      // Node >= 22.4 defines `localStorage` on `globalThis` as a getter that returns
      // `undefined` unless `--localstorage-file` is passed, and happy-dom then leaves the
      // key alone because it is already there. This puts a working one back when — and
      // only when — that has happened. See the file's header for why the fix cannot be
      // `--no-experimental-webstorage`: that flag is a startup error on CI's Node 20.
      setupFiles: ['./src/tests/setup/webStorage.ts'],

      // Vitest stubs every CSS request to an empty string by default, and its idea of a
      // CSS request is the extension — so `bubbles.css?raw` was stubbed too, and a test
      // that reads a stylesheet as source got `''` and asserted nothing while passing.
      // `comicBookImageBorders.test.tsx` had been green that way since it was written.
      // Processing the skin's stylesheets for real is what makes those assertions mean
      // something; `include` keeps it to the files a test actually reads.
      css: { include: [/src[\\/]skins[\\/]/] },

      // `bundlePolicy.test.ts` measures `dist/`, so it only means anything after a
      // build. It fails rather than skips when there is none — see its header — which
      // would make a plain `npm run test:run` red on any tree nobody has built. So it
      // is excluded here and reached through `npm run test:bundle`, which builds first.
      exclude: [...configDefaults.exclude, '**/bundlePolicy.test.ts'],
      // Pin the API base to empty so URL assertions stay hermetic regardless of
      // any ambient VITE_API_BASE_URL in the shell/CI. The app talks to the
      // backend through the dev-server proxy (relative paths), so '' is correct.
      env: {
        VITE_API_BASE_URL: '',
      },
    },
  }
})
