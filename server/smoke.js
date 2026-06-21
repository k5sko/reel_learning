// End-to-end smoke test of the memory pipeline (no network, no keys).
// Run: npm run smoke
import { getStore } from './store.js'
import { saveLesson } from './pipeline.js'

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg)
    process.exit(1)
  }
}

const store = await getStore()
const seeded = store.getGraph()
console.log(`seed graph: ${seeded.nodes.length} nodes, ${seeded.edges.length} edges`)
assert(seeded.nodes.length >= 8, 'seed graph should be populated')

// Save a clip that should connect to existing quantum knowledge.
const r1 = await saveLesson({
  title: 'Reading a Quantum Circuit',
  subject: 'Quantum Computing',
  channel: 'Qiskit',
  description: 'Gates, wires, and measurement — left to right.',
  interests: ['Quantum Computing'],
})
console.log(`save 1: +${r1.addedNodes.length} nodes, +${r1.addedEdges.length} edges -> "${r1.lessonTitle}"`)
assert(r1.newNodeIds.length >= 1, 'should add at least one memory point')
assert(r1.addedEdges.length >= 1, 'new point should connect to the graph')

// Save a cross-subject clip.
const r2 = await saveLesson({
  title: 'Eigenvectors, Visually',
  subject: 'Linear Algebra',
  channel: '3Blue1Brown',
  description: 'The vectors a transform only stretches, never turns.',
  interests: ['Linear Algebra'],
})
console.log(`save 2: +${r2.addedNodes.length} nodes, +${r2.addedEdges.length} edges`)
assert(r2.addedEdges.some((e) => e.relation === 'builds on' || e.relation === 'related to'), 'reasoned link expected')

const finalGraph = store.getGraph()
console.log(`final graph: ${finalGraph.nodes.length} nodes, ${finalGraph.edges.length} edges`)
assert(finalGraph.nodes.length > seeded.nodes.length, 'graph should grow after saves')

// every edge references real nodes
const ids = new Set(finalGraph.nodes.map((n) => n.id))
for (const e of finalGraph.edges) {
  assert(ids.has(e.from) && ids.has(e.to), `edge ${e.id} references missing node`)
}

console.log('\nOK — pipeline produces a connected, growing memory graph.')
process.exit(0)
