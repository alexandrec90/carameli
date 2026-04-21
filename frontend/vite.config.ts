/// <reference types="vitest" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

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
    plugins: [react()],
    server: {
      port: 5173,
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
    },
  }
})
