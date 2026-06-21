// Full live integration test: real Redis + real Claude + real Arize.
// Saves several real clips through the pipeline and inspects every stage.
// Run: node server/integration.js   (needs .env / .env.example keys)

import { config, flags, modeBanner } from './config.js'
import { getStore } from './store.js'
import { saveLesson } from './pipeline.js'
import { recentSpans, flushArize } from './arize.js'
import { CLIPS } from '../src/data/mockClips.js'

const line = (c = '─') => console.log(c.repeat(58))
let failures = 0
function check(cond, msg) {
  console.log(`${cond ? '  ✓' : '  ✗ FAIL:'} ${msg}`)
  if (!cond) failures++
}

console.log('\n' + modeBanner())
line('═')
check(flags.claude, 'Claude is LIVE (not mock)')
check(flags.redis, 'Redis is LIVE (not mock)')
check(flags.arize, 'Arize is LIVE (not mock)')

const store = await getStore()
await store.reset() // clean slate on Redis
const seed = store.getGraph()
console.log(`\nseed graph: ${seed.nodes.length} nodes, ${seed.edges.length} edges (redis=${seed.meta.redis})`)

// Save one clip per subject + a second quantum clip to force a cross-link.
const picks = ['c1', 'c4', 'c7', 'c10', 'c2'].map((id) => CLIPS.find((c) => c.id === id))

for (const clip of picks) {
  line()
  console.log(`SAVE: "${clip.title}"  [${clip.subjectTag}]`)
  const r = await saveLesson({
    title: clip.title,
    subject: clip.subjectTag,
    channel: clip.channel,
    description: clip.description,
    interests: [clip.subjectTag],
  })
  console.log(`  lessonTitle: ${r.lessonTitle}`)
  console.log(`  +${r.addedNodes.length} nodes, +${r.addedEdges.length} edges`)
  for (const e of r.addedEdges) {
    const to = store.nodes.get(e.to)
    console.log(`     ${e.relation.padEnd(16)} → ${to ? to.title : e.to}   (${e.why})`)
  }
  check(r.newNodeIds.length >= 1, 'produced ≥1 memory point')
  check(r.addedEdges.length >= 1, 'connected into the graph')
}

// ---- graph integrity ----
line('═')
const g = store.getGraph()
console.log(`final graph: ${g.nodes.length} nodes, ${g.edges.length} edges`)
const ids = new Set(g.nodes.map((n) => n.id))
check(
  g.edges.every((e) => ids.has(e.from) && ids.has(e.to)),
  'every edge references real nodes (no dangling)',
)
check(g.nodes.length > seed.nodes.length, 'graph grew beyond the seed')
const connected = new Set()
g.edges.forEach((e) => {
  connected.add(e.from)
  connected.add(e.to)
})
const orphans = g.nodes.filter((n) => !connected.has(n.id))
check(orphans.length === 0, `no orphan nodes (orphans: ${orphans.map((o) => o.title).join(', ') || 'none'}`)

// ---- Redis really persisted it ----
line()
const { createClient } = await import('redis')
const probe = createClient({ url: config.redisUrl })
await probe.connect()
const nodeCount = await probe.hLen('mem:nodes')
const edgeCount = await probe.hLen('mem:edges')
const sample = JSON.parse((await probe.hVals('mem:nodes'))[0])
await probe.quit()
console.log(`Redis mem:nodes=${nodeCount}  mem:edges=${edgeCount}`)
check(nodeCount === g.nodes.length, 'Redis node count matches in-memory graph')
check(typeof sample.embedding === 'undefined' || Array.isArray(sample.embedding), 'persisted node shape ok')

// ---- Arize spans ----
line()
const spans = recentSpans()
const extract = spans.filter((s) => s.name === 'extract_memory')
const connect = spans.filter((s) => s.name === 'reason_connections')
console.log(`Arize spans: ${spans.length} total  (${extract.length} extract, ${connect.length} connect)`)
check(extract.length >= picks.length, 'one extract span per save')
check(
  extract.every((s) => typeof s.memoryPointCount === 'number'),
  'extract spans carry memoryPointCount eval',
)
check(
  connect.every((s) => typeof s.linkCount === 'number'),
  'connect spans carry linkCount eval',
)
await flushArize()
console.log('  flushed spans to Arize')

line('═')
if (failures === 0) {
  console.log('ALL CHECKS PASSED ✓  — live Redis + Claude + Arize, connected graph.')
  process.exit(0)
} else {
  console.log(`${failures} CHECK(S) FAILED ✗`)
  process.exit(1)
}
