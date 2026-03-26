/// <reference types="vitest" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Inside Docker the backend is the "app" service; on the host it's 127.0.0.1.
const backendUrl = process.env.VITE_PROXY_TARGET || 'http://127.0.0.1:8000'

export default defineConfig({
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
    environment: 'jsdom',
    globals: true,
  },
})
