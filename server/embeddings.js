// Embeddings for semantic recall.
//
// Vectors are what let Redis find which *prior* memory points a new lesson
// connects to — they are the heart of the "Obsidian-style connection" step.
//
// Default is a dependency-free, deterministic local embedder (hashed bag of
// words) so recall works with zero setup. It is intentionally simple but good
// enough to cluster related concepts (subject terms dominate). Swap `embed`
// for a hosted embedding model later without touching the pipeline.

import { config } from './config.js'

const DIM = config.embedDim

// Subject words carry the most signal for "what connects to what", so weight
// them up. Stopwords are dropped so short clip titles still embed meaningfully.
const STOP = new Set(
  'a an the of to in on for and or is are be with at as by from your you it this that what why how into one two no not s'.split(
    ' ',
  ),
)

function tokens(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
}

// FNV-1a hash -> bucket index, with a sign bucket so features can cancel.
function hash(word) {
  let h = 0x811c9dc5
  for (let i = 0; i < word.length; i++) {
    h ^= word.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function embed({ title = '', summary = '', subject = '' }) {
  const vec = new Array(DIM).fill(0)
  const add = (text, weight) => {
    for (const w of tokens(text)) {
      const hv = hash(w)
      const idx = hv % DIM
      const sign = (hv >> 16) & 1 ? 1 : -1
      vec[idx] += sign * weight
    }
  }
  // subject >> title > summary for connection signal
  add(subject, 3)
  add(subject, 3) // double-count: subject is the strongest grouping cue
  add(title, 2)
  add(summary, 1)

  // L2 normalize so cosine == dot product
  let norm = 0
  for (const v of vec) norm += v * v
  norm = Math.sqrt(norm) || 1
  return vec.map((v) => v / norm)
}

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot // both already normalized
}
