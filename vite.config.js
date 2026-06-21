import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Proxy /api to the clipper FastAPI backend so the browser can use relative
// URLs (no CORS) in dev. Run the backend with:
//   .venv/bin/uvicorn clipper.api:app --port 8000
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
