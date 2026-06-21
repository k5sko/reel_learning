// Framework-free request handler for the memory API. Mounted two ways:
//   - inside the Vite dev server as middleware (vite.config.js) -> one command
//   - as a standalone Node http server (server/index.js) -> prod / separate run
//
// Routes:
//   GET  /api/memory/health   capability flags
//   GET  /api/memory/graph    full node+edge graph
//   POST /api/memory/save     run the save pipeline for a watched lesson
//   POST /api/memory/reset    clear + reseed (handy mid-demo)
//   GET  /api/memory/trace    recent Arize spans (for a debug peek)

import { getStore } from './store.js'
import { saveLesson } from './pipeline.js'
import { recentSpans } from './arize.js'
import { flags, modeBanner } from './config.js'

function send(res, status, body) {
  const json = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(json)
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => {
      data += c
      if (data.length > 1e6) reject(new Error('payload too large'))
    })
    req.on('end', () => {
      if (!data) return resolve({})
      try {
        resolve(JSON.parse(data))
      } catch {
        reject(new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

export async function handleApi(req, res) {
  const url = new URL(req.url, 'http://localhost')
  if (!url.pathname.startsWith('/api/memory')) return false

  try {
    const route = `${req.method} ${url.pathname}`
    switch (route) {
      case 'GET /api/memory/health': {
        send(res, 200, { ok: true, mode: modeBanner(), flags: { ...flags } })
        return true
      }
      case 'GET /api/memory/graph': {
        const store = await getStore()
        send(res, 200, store.getGraph())
        return true
      }
      case 'POST /api/memory/save': {
        const body = await readJson(req)
        const lesson = normalizeLesson(body)
        if (!lesson) {
          send(res, 400, { error: 'lesson requires at least a title and subject' })
          return true
        }
        const result = await saveLesson(lesson)
        send(res, 200, result)
        return true
      }
      case 'POST /api/memory/reset': {
        const store = await getStore()
        const graph = await store.reset()
        send(res, 200, graph)
        return true
      }
      case 'GET /api/memory/trace': {
        send(res, 200, { spans: recentSpans() })
        return true
      }
      default: {
        send(res, 404, { error: `no route for ${route}` })
        return true
      }
    }
  } catch (e) {
    console.error('[api] error:', e)
    send(res, 500, { error: String(e.message || e) })
    return true
  }
}

function normalizeLesson(body) {
  const title = String(body.title || '').trim()
  const subject = String(body.subject || '').trim()
  if (!title || !subject) return null
  return {
    title,
    subject,
    channel: String(body.channel || '').trim(),
    description: String(body.description || '').trim(),
    interests: Array.isArray(body.interests) ? body.interests.slice(0, 12) : [],
  }
}
