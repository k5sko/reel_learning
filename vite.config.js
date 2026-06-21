import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Mount the memory API (/api/memory/*) inside the dev server so it runs in the
// same process as the frontend. This middleware runs BEFORE the proxy below, so
// memory requests are handled in-process and everything else under /api falls
// through to the clipper FastAPI backend. The same handler also runs standalone
// via `node server/index.js`.
function memoryApi() {
  return {
    name: 'memory-api',
    async configureServer(server) {
      const { handleApi } = await import('./server/handler.js')
      const { modeBanner } = await import('./server/config.js')
      const { getStore } = await import('./server/store.js')
      await getStore() // warm + seed
      server.config.logger.info(`  \x1b[36m➜\x1b[0m  ${modeBanner()}`)
      server.middlewares.use(async (req, res, next) => {
        try {
          const handled = await handleApi(req, res)
          if (!handled) next()
        } catch (e) {
          next(e)
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), memoryApi()],
  server: {
    // Clipper FastAPI backend. /api/memory is served in-process (above); all
    // other /api/* requests are proxied here. Run it with:
    //   .venv/bin/uvicorn clipper.api:app --port 8000
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
