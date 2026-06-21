// Standalone memory API server. Use this to run the backend on its own port
// (e.g. for a separate deploy). For local dev you don't need it — the same
// handler is mounted inside Vite (see vite.config.js), so `npm run dev` is enough.
//
//   node server/index.js        # PORT defaults to 3001

import { createServer } from 'node:http'
import { handleApi } from './handler.js'
import { getStore } from './store.js'
import { modeBanner } from './config.js'

const PORT = Number(process.env.PORT) || 3001

const server = createServer(async (req, res) => {
  // permissive CORS so a separately-hosted frontend can call it
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    return res.end()
  }
  const handled = await handleApi(req, res)
  if (!handled) {
    res.statusCode = 404
    res.end('not found')
  }
})

await getStore() // warm + seed before listening
server.listen(PORT, () => {
  console.log(`[memory] ${modeBanner()}`)
  console.log(`[memory] listening on http://localhost:${PORT}`)
})
