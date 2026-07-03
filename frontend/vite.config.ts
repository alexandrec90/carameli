/// <reference types="vitest" />
import { writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const rootDir = dirname(fileURLToPath(import.meta.url))

/**
 * Dev-only middleware for the comic-book layout editor's "Save" button. Overwrites
 * the editor's source-of-truth config file with the verbatim TS body POSTed by the
 * client. Registered via `configureServer`, so it exists only in the dev server and
 * is never part of a production build. Writes a fixed path — client-supplied paths
 * are ignored — so it can't be coerced into writing elsewhere.
 */
function comicEditorSavePlugin(): Plugin {
  const target = resolve(rootDir, 'src/skins/comic-book/editor/layoutConfig.ts')
  return {
    name: 'comic-editor-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__comic-editor/save', (req, res, next) => {
        if (req.method !== 'POST') return next()
        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', () => {
          try {
            const { content } = JSON.parse(body) as { content?: unknown }
            if (typeof content !== 'string' || !content.includes('PANEL_IMG_TRANSFORMS')) {
              res.statusCode = 400
              res.end('Invalid config payload')
              return
            }
            writeFile(target, content, 'utf8')
              .then(() => {
                res.statusCode = 204
                res.end()
              })
              .catch(err => {
                server.config.logger.error(`[comic-editor] save failed: ${String(err)}`)
                res.statusCode = 500
                res.end('Write failed')
              })
          } catch (err) {
            server.config.logger.error(`[comic-editor] bad save body: ${String(err)}`)
            res.statusCode = 400
            res.end('Malformed JSON')
          }
        })
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
    plugins: [react(), comicEditorSavePlugin()],
    server: {
      port: 5173,

      // The Docker-hosted MCP browser reaches the dev server via
      // host.docker.internal; Vite's host check blocks it by default.
      allowedHosts: ['host.docker.internal'],

      // On Windows, inotify file-change events don't propagate across the
      // Docker bind mount, so Vite's native watcher never sees edits and HMR
      // silently stops working (a restart is the only way changes show up).
      // Polling fixes it. Gated on CHOKIDAR_USEPOLLING (set only in
      // docker-compose) so local non-Docker dev keeps fast native watching.
      watch: process.env.CHOKIDAR_USEPOLLING
        ? { usePolling: true, interval: 100 }
        : undefined,
      proxy: {
        '/auth': backendUrl,
        '/vsapi': backendUrl,
        '/vg': backendUrl,
        '/health': backendUrl,
      },
    },
    test: {
      environment: 'happy-dom',
      globals: true,
      // Pin the API base to empty so URL assertions stay hermetic regardless of
      // any ambient VITE_API_BASE_URL in the shell/CI. The app talks to the
      // backend through the dev-server proxy (relative paths), so '' is correct.
      env: {
        VITE_API_BASE_URL: '',
      },
    },
  }
})
