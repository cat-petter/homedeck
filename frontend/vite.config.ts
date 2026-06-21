import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Dev server binds 0.0.0.0 for LAN/Tailscale access and proxies /api to the
// FastAPI backend so the browser talks to a single origin (no CORS).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8770',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
})
