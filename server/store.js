// The memory store — Redis when REDIS_URL is set, in-memory otherwise.
//
// SPONSOR-CRITICAL (Redis): nodes, edges and their embedding vectors live in
// Redis. Recall — finding which prior memory points a new lesson connects to —
// reads those vectors back and ranks by cosine similarity. That retrieval step
// is what builds the Obsidian-style links, so without Redis there is no graph
// to persist and nothing to connect against.
//
// Vectors are ranked in-process here for portability (works on any Redis, no
// modules required). The natural next step is RediSearch FT KNN so the vector
// search runs *inside* Redis — the interface below (`similar`) wouldn't change.

import { randomUUID } from 'node:crypto'
import { config, flags } from './config.js'
import { embed, cosine } from './embeddings.js'
import { seedGraph, seedLessons, SUBJECT_ACCENT, PALETTE } from './seed.js'

const NODES_KEY = 'mem:nodes'
const EDGES_KEY = 'mem:edges'
const LESSONS_KEY = 'mem:lessons'
const COLORS_KEY = 'mem:colors'

class Store {
  constructor() {
    this.nodes = new Map() // id -> node (includes embedding)
    this.edges = new Map() // id -> edge
    this.lessons = new Map() // id -> saved-lesson record
    this.colors = new Map(Object.entries(SUBJECT_ACCENT)) // subject -> accent
    this.redis = null
    this.ready = null
  }

  // Stable color per category (subject). Canonical subjects keep their color;
  // each new subject claims the next unused palette color (no collisions, no
  // two categories sharing a color until the palette is exhausted).
  async accentFor(subject) {
    if (this.colors.has(subject)) return this.colors.get(subject)
    const used = new Set(this.colors.values())
    const next = PALETTE.find((c) => !used.has(c)) ?? PALETTE[this.colors.size % PALETTE.length]
    this.colors.set(subject, next)
    if (this.redis) await this.redis.hSet(COLORS_KEY, subject, next)
    return next
  }

  init() {
    if (!this.ready) this.ready = this._init()
    return this.ready
  }

  async _init() {
    if (flags.redis) {
      try {
        const { createClient } = await import('redis')
        this.redis = createClient({ url: config.redisUrl })
        this.redis.on('error', (e) => console.error('[redis]', e.message))
        await this.redis.connect()
        await this._loadFromRedis()
      } catch (e) {
        console.error('[redis] connect failed, falling back to memory:', e.message)
        this.redis = null
      }
    }
    if (this.nodes.size === 0) await this._seed()
    return this
  }

  async _loadFromRedis() {
    const [nodes, edges, lessons, colors] = await Promise.all([
      this.redis.hGetAll(NODES_KEY),
      this.redis.hGetAll(EDGES_KEY),
      this.redis.hGetAll(LESSONS_KEY),
      this.redis.hGetAll(COLORS_KEY),
    ])
    for (const [subject, accent] of Object.entries(colors)) this.colors.set(subject, accent)
    for (const v of Object.values(nodes)) {
      const n = JSON.parse(v)
      this.nodes.set(n.id, n)
    }
    for (const v of Object.values(edges)) {
      const e = JSON.parse(v)
      this.edges.set(e.id, e)
    }
    for (const v of Object.values(lessons)) {
      const l = JSON.parse(v)
      this.lessons.set(l.id, l)
    }
  }

  async _seed() {
    const { nodes, edges } = seedGraph()
    for (const n of nodes) await this.addNode({ ...n, embedding: embed(n) })
    for (const e of edges) await this.addEdge(e)
    for (const l of seedLessons()) await this.addLesson(l)
  }

  async addLesson(lesson) {
    this.lessons.set(lesson.id, lesson)
    if (this.redis) await this.redis.hSet(LESSONS_KEY, lesson.id, JSON.stringify(lesson))
    return lesson
  }

  async addNode(node) {
    this.nodes.set(node.id, node)
    if (this.redis) await this.redis.hSet(NODES_KEY, node.id, JSON.stringify(node))
    return node
  }

  async addEdge(edge) {
    const e = edge.id ? edge : { ...edge, id: `edge-${randomUUID().slice(0, 8)}` }
    // de-dupe: one relation per (from,to)
    for (const existing of this.edges.values()) {
      if (existing.from === e.from && existing.to === e.to) return existing
    }
    this.edges.set(e.id, e)
    if (this.redis) await this.redis.hSet(EDGES_KEY, e.id, JSON.stringify(e))
    return e
  }

  // Cosine KNN over stored embeddings. `excludeIds` skips the just-created node
  // and its siblings; `threshold` drops weak matches.
  similar(vector, { k = 4, excludeIds = [], threshold = 0.12 } = {}) {
    const skip = new Set(excludeIds)
    const scored = []
    for (const node of this.nodes.values()) {
      if (skip.has(node.id) || !node.embedding) continue
      const score = cosine(vector, node.embedding)
      if (score >= threshold) scored.push({ node, score })
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, k)
  }

  // Public graph payload — strip embeddings (heavy, not needed by the UI).
  getGraph() {
    const nodes = [...this.nodes.values()].map(({ embedding, ...n }) => n)
    const edges = [...this.edges.values()]
    const lessons = [...this.lessons.values()].sort((a, b) => b.createdAt - a.createdAt)
    return {
      nodes,
      edges,
      lessons,
      meta: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        lessonCount: lessons.length,
        redis: Boolean(this.redis),
      },
    }
  }

  newId(prefix) {
    return `${prefix}-${randomUUID().slice(0, 8)}`
  }

  async reset() {
    this.nodes.clear()
    this.edges.clear()
    this.lessons.clear()
    this.colors = new Map(Object.entries(SUBJECT_ACCENT))
    if (this.redis) await this.redis.del([NODES_KEY, EDGES_KEY, LESSONS_KEY, COLORS_KEY])
    await this._seed()
    return this.getGraph()
  }
}

let _store = null
export async function getStore() {
  if (!_store) _store = new Store()
  await _store.init()
  return _store
}
