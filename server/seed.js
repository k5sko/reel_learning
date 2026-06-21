// Starter knowledge graph so the demo opens on something alive, not a blank
// canvas. These represent lessons the learner "already saved" before the demo.
// New saves connect INTO this graph.
//
// Accents match the frontend subject palette (see src/data/mockClips.js).

// Canonical colors for the known subjects (match the feed palette).
export const SUBJECT_ACCENT = {
  'Quantum Computing': 'blue',
  'Organic Chemistry': 'green',
  Macroeconomics: 'amber',
  'Linear Algebra': 'purple',
}

// Color = CATEGORY (subject), never the individual lesson — every lesson in a
// subject shares its color. The store assigns each NEW subject the next unused
// palette color (order-based, no collisions). See store.accentFor().
export const PALETTE = ['blue', 'green', 'amber', 'purple', 'pink', 'teal']

// Used by the seed builders (all canonical subjects). Live/unknown subjects go
// through the store's collision-free registry instead.
export function accentForSubject(subject) {
  return SUBJECT_ACCENT[subject] || PALETTE[0]
}

// id, type, title, summary, subject
const NODES = [
  // lesson plans (hubs)
  ['lp-quantum', 'lesson_plan', 'Quantum Foundations', 'Core ideas behind qubits and measurement.', 'Quantum Computing'],
  ['lp-orgchem', 'lesson_plan', 'Reaction Mechanisms', 'How and why organic reactions proceed.', 'Organic Chemistry'],
  ['lp-macro', 'lesson_plan', 'Money & Rates', 'What sets interest rates and prices.', 'Macroeconomics'],
  ['lp-linalg', 'lesson_plan', 'Vectors & Transforms', 'Geometry of linear maps.', 'Linear Algebra'],
  // memory points
  ['mp-superpos', 'memory_point', 'Qubits & Superposition', 'A qubit holds 0 and 1 at once until measured.', 'Quantum Computing'],
  ['mp-collapse', 'memory_point', 'Measurement Collapse', 'Observing a qubit forces it into a definite state.', 'Quantum Computing'],
  ['mp-sn', 'memory_point', 'SN1 vs SN2', 'Substrate and solvent decide the substitution path.', 'Organic Chemistry'],
  ['mp-loanable', 'memory_point', 'Loanable Funds', 'Supply and demand for savings set the interest rate.', 'Macroeconomics'],
  ['mp-eigen', 'memory_point', 'Eigenvectors', 'Vectors a transform only stretches, never rotates.', 'Linear Algebra'],
  ['mp-det', 'memory_point', 'Determinant as Area', 'The determinant is how much a map scales area.', 'Linear Algebra'],
]

// from, to, relation, why
const EDGES = [
  ['mp-superpos', 'lp-quantum', 'part of', 'foundational quantum idea'],
  ['mp-collapse', 'lp-quantum', 'part of', 'foundational quantum idea'],
  ['mp-collapse', 'mp-superpos', 'builds on', 'collapse acts on superposition'],
  ['mp-sn', 'lp-orgchem', 'part of', 'core mechanism'],
  ['mp-loanable', 'lp-macro', 'part of', 'rate-setting model'],
  ['mp-eigen', 'lp-linalg', 'part of', 'core transform concept'],
  ['mp-det', 'lp-linalg', 'part of', 'core transform concept'],
  ['mp-det', 'mp-eigen', 'related to', 'both describe a transform'],
]

export function seedGraph() {
  const nodes = NODES.map(([id, type, title, summary, subject]) => ({
    id,
    type,
    title,
    summary,
    subject,
    accent: accentForSubject(subject),
    isSeed: true,
    createdAt: 0,
  }))
  const edges = EDGES.map(([from, to, relation, why], i) => ({
    id: `seed-edge-${i}`,
    from,
    to,
    relation,
    why,
    weight: relation === 'part of' ? 0.5 : 0.8,
  }))
  return { nodes, edges }
}

// First-class "saved lesson" records — what the learner saved, each owning the
// memory points it produced. These are what the Library lists.
// id, title, subject, pointIds[]
const LESSONS = [
  ['lesson-quantum', 'Quantum Foundations', 'Quantum Computing', ['mp-superpos', 'mp-collapse']],
  ['lesson-orgchem', 'Substitution Reactions', 'Organic Chemistry', ['mp-sn']],
  ['lesson-macro', 'What Sets Interest Rates', 'Macroeconomics', ['mp-loanable']],
  ['lesson-linalg', 'Geometry of Transforms', 'Linear Algebra', ['mp-eigen', 'mp-det']],
]

export function seedLessons() {
  return LESSONS.map(([id, title, subject, pointIds], i) => ({
    id,
    title,
    subject,
    accent: accentForSubject(subject),
    channel: 'Saved earlier',
    pointIds,
    createdAt: i + 1, // small, stable order; live saves use real timestamps
    isSeed: true,
  }))
}
