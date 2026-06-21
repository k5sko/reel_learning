// Claude — the reasoning that turns a watched lesson into structured memory and
// decides how it connects to what the learner already knows.
//
// Two jobs:
//   extractMemory(lesson)        -> memory points + a lesson-plan summary
//   reasonConnections(point, candidates) -> which prior nodes link, and how
//
// Real mode calls Claude (lazy-loaded SDK) when ANTHROPIC_API_KEY is set.
// Mock mode is a deterministic heuristic with the SAME output shape, so the
// graph looks and behaves identically in a no-key demo.

import { config, flags } from './config.js'

// Cap each call so a slow/throttled API never hangs a live save — on timeout
// we fall back to the deterministic heuristic instead of spinning.
const CALL_TIMEOUT_MS = 14000

let _client = null
async function client() {
  if (_client) return _client
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  _client = new Anthropic({
    apiKey: config.anthropicKey,
    timeout: CALL_TIMEOUT_MS,
    maxRetries: 1,
  })
  return _client
}

// Pull the first JSON object/array out of a model response.
function parseJson(text) {
  const start = text.search(/[[{]/)
  if (start === -1) throw new Error('no json in response')
  const open = text[start]
  const close = open === '[' ? ']' : '}'
  let depth = 0
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++
    else if (text[i] === close && --depth === 0) {
      return JSON.parse(text.slice(start, i + 1))
    }
  }
  throw new Error('unbalanced json in response')
}

async function ask(system, user, maxTokens = 700) {
  const c = await client()
  const res = await c.messages.create({
    model: config.anthropicModel,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  })
  return res.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
}

// ---------------------------------------------------------------------------
// 1. Extraction
// ---------------------------------------------------------------------------

const EXTRACT_SYSTEM = `You are the memory layer of an educational short-video app.
A learner just watched a clip. From the title, channel, subject and description ONLY
(you never see the video), produce the durable things worth remembering.
Return STRICT JSON:
{"lessonTitle": string, "memoryPoints": [{"title": string (<=6 words, a concept),
"summary": string (<=18 words, what they learned)}]}
1-2 memory points. No prose outside the JSON.`

export async function extractMemory(lesson) {
  if (flags.claude) {
    const user = JSON.stringify({
      subject: lesson.subject,
      title: lesson.title,
      channel: lesson.channel,
      description: lesson.description,
      learnerInterests: lesson.interests,
    })
    try {
      const raw = await ask(EXTRACT_SYSTEM, user)
      return normalizeExtract(parseJson(raw), lesson)
    } catch (e) {
      console.error('[claude] extract failed, using heuristic:', e.message)
      return mockExtract(lesson)
    }
  }
  return mockExtract(lesson)
}

function normalizeExtract(out, lesson) {
  const points = Array.isArray(out.memoryPoints) ? out.memoryPoints : []
  const clean = points
    .filter((p) => p && p.title)
    .slice(0, 2)
    .map((p) => ({
      title: String(p.title).trim(),
      summary: String(p.summary || lesson.description || '').trim(),
      subject: lesson.subject,
    }))
  if (!clean.length) return mockExtract(lesson)
  return { lessonTitle: out.lessonTitle || `${lesson.subject} Lesson`, memoryPoints: clean }
}

function mockExtract(lesson) {
  // Heuristic stand-in: the clip's concept is the primary memory point; if the
  // description reads as two ideas ("X and Y", "X; Y"), split into a second.
  const points = [{ title: lesson.title, summary: lesson.description, subject: lesson.subject }]
  const m = String(lesson.description || '').split(/\s+(?:and|&|;|—|--)\s+/i)
  if (m.length === 2 && m[1].length > 12) {
    const second = m[1].replace(/[.?!]+$/, '')
    points.push({
      title: second.split(/\s+/).slice(0, 5).join(' '),
      summary: second,
      subject: lesson.subject,
    })
  }
  return { lessonTitle: `${lesson.subject}: ${lesson.title}`, memoryPoints: points }
}

// ---------------------------------------------------------------------------
// 2. Connection reasoning
// ---------------------------------------------------------------------------

const CONNECT_SYSTEM = `You connect a NEW memory point to a learner's EXISTING knowledge graph,
Obsidian-style. Given the new point and candidate existing nodes (pre-filtered by similarity),
decide which are genuinely related and name the relationship.
Allowed relations: "builds on", "prerequisite for", "related to", "contrasts with", "applies".
Return STRICT JSON: {"links": [{"id": <candidate id>, "relation": <one allowed relation>,
"why": string (<=12 words)}]}. Only include real links (0-3). No prose outside JSON.`

export async function reasonConnections(point, candidates) {
  if (!candidates.length) return []
  if (flags.claude) {
    const user = JSON.stringify({
      newPoint: { title: point.title, summary: point.summary, subject: point.subject },
      candidates: candidates.map((c) => ({
        id: c.node.id,
        title: c.node.title,
        subject: c.node.subject,
        type: c.node.type,
        similarity: Number(c.score.toFixed(3)),
      })),
    })
    try {
      const out = parseJson(await ask(CONNECT_SYSTEM, user))
      const byId = new Map(candidates.map((c) => [c.node.id, c]))
      return (out.links || [])
        .filter((l) => byId.has(l.id))
        .slice(0, 3)
        .map((l) => ({ to: l.id, relation: l.relation || 'related to', why: l.why || '' }))
    } catch {
      return mockConnect(point, candidates)
    }
  }
  return mockConnect(point, candidates)
}

function mockConnect(point, candidates) {
  // Same-subject + high similarity => "builds on"; cross-subject but similar =>
  // "related to". Mirrors what the model returns, deterministically.
  return candidates
    .filter((c) => c.score > 0.25 || c.node.subject === point.subject)
    .slice(0, 3)
    .map((c) => {
      const sameSubject = c.node.subject === point.subject
      const relation = sameSubject ? 'builds on' : 'related to'
      const why = sameSubject
        ? `extends ${c.node.subject.toLowerCase()} concepts`
        : `shares ideas with ${c.node.title.toLowerCase()}`
      return { to: c.node.id, relation, why }
    })
}
