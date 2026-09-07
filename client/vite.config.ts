import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Lets the frontend call relative /api/... paths in every context: this dev
      // server proxies them to the backend, the built static bundle is served by
      // that same backend in Docker (same origin, no proxy needed), and dev-all.mjs
      // still works unchanged since it sets VITE_API_URL for the backend's actual
      // (possibly dynamic) port and this file reads it directly via process.env -
      // that's a Node-side read of the Vite config, not the client-only
      // import.meta.env, so it isn't restricted to VITE_-prefixed vars exposed to
      // browser code.
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:8001',
        changeOrigin: true,
      },
    },
  },
})