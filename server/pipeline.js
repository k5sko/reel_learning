// The save → memory-graph pipeline. This is the heart of the memory agent.
//
//   1. Claude extracts memory points + a lesson summary from the lesson context
//   2. Each point is embedded and Redis recalls the nearest prior nodes
//   3. Claude reasons over those candidates and names the real connections
//   4. Nodes + edges are persisted to Redis
//   5. We return exactly what was added, so the UI can light up the new nodes
//
// Every reasoning call is wrapped in an Arize span (see arize.js).

import { getStore } from './store.js'
import { embed } from './embeddings.js'
import { extractMemory, reasonConnections } from './claude.js'
import { trace } from './arize.js'

export async function saveLesson(lesson) {
  const store = await getStore()

  // 1. Extract -------------------------------------------------------------
  const extraction = await trace(
    'extract_memory',
    { subject: lesson.subject, title: lesson.title },
    () => extractMemory(lesson),
    (r) => ({ memoryPointCount: r.memoryPoints.length }),
  )

  const accent = await store.accentFor(lesson.subject)

  // Ensure a lesson-plan hub for this subject exists, so memory points always
  // hang off something — this is the "lesson plan builds up a topic" structure.
  const lessonPlan = ensureLessonPlan(store, lesson, extraction, accent)

  const newNodes = []
  const newEdges = []

  // 2. Build each memory point + recall its candidates against the CURRENT
  // graph (before adding new nodes, so siblings don't pre-link).
  const prepared = extraction.memoryPoints.map((point) => {
    const node = {
      id: store.newId('mp'),
      type: 'memory_point',
      title: point.title,
      summary: point.summary,
      subject: point.subject || lesson.subject,
      accent,
      isSeed: false,
      createdAt: Date.now(),
    }
    node.embedding = embed(node)
    const candidates = store.similar(node.embedding, { k: 4, excludeIds: [node.id] })
    return { node, candidates }
  })

  // 3. Reason all connections concurrently — independent reads, so this cuts
  // multi-point save latency roughly in half.
  const linkSets = await Promise.all(
    prepared.map(({ node, candidates }) =>
      trace(
        'reason_connections',
        { point: node.title, candidateCount: candidates.length },
        () => reasonConnections(node, candidates),
        (r) => ({ linkCount: r.length }),
      ),
    ),
  )

  // 4. Persist nodes + edges sequentially (deterministic order).
  for (let i = 0; i < prepared.length; i++) {
    const { node } = prepared[i]
    await store.addNode(node)
    newNodes.push(node)

    // membership edge to the subject lesson plan
    if (lessonPlan && lessonPlan.id !== node.id) {
      newEdges.push(
        await store.addEdge({
          from: node.id,
          to: lessonPlan.id,
          relation: 'part of',
          why: `part of ${lessonPlan.title}`,
          weight: 0.5,
        }),
      )
    }

    // reasoned connections to prior knowledge
    for (const link of linkSets[i]) {
      if (link.to === node.id) continue
      newEdges.push(
        await store.addEdge({
          from: node.id,
          to: link.to,
          relation: link.relation,
          why: link.why,
          weight: 0.85,
        }),
      )
    }
  }

  // Record the saved lesson as a first-class, listable entity (the Library row).
  const lesson_ = await store.addLesson({
    id: store.newId('lesson'),
    title: extraction.lessonTitle || `${lesson.subject} Lesson`,
    subject: lesson.subject,
    accent,
    channel: lesson.channel || '',
    sourceTitle: lesson.title,
    pointIds: newNodes.map((n) => n.id),
    pointTitles: newNodes.map((n) => n.title),
    createdAt: Date.now(),
    isSeed: false,
  })

  const strip = ({ embedding, ...n }) => n
  return {
    lesson: lesson_,
    lessonTitle: extraction.lessonTitle,
    addedNodes: [lessonPlan && lessonPlan._new ? strip(lessonPlan) : null, ...newNodes.map(strip)].filter(
      Boolean,
    ),
    newNodeIds: newNodes.map((n) => n.id),
    addedEdges: newEdges,
    graph: store.getGraph(),
  }
}

// Find the existing lesson-plan hub for this subject, or create one.
function ensureLessonPlan(store, lesson, extraction, accent) {
  for (const n of store.nodes.values()) {
    if (n.type === 'lesson_plan' && n.subject === lesson.subject) return n
  }
  const node = {
    id: store.newId('lp'),
    type: 'lesson_plan',
    title: extraction.lessonTitle || `${lesson.subject} Lesson`,
    summary: `Saved lessons in ${lesson.subject}.`,
    subject: lesson.subject,
    accent,
    isSeed: false,
    createdAt: Date.now(),
  }
  node.embedding = embed(node)
  store.addNode(node)
  return { ...node, _new: true } // _new flag is transient, not persisted
}
