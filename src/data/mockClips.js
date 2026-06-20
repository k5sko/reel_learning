// Mock dataset for the UI prototype.
// Swap this module for a real data source later — keep the shape:
//   Clip { id, title, channel, subjectTag, durationSec, relevanceScore,
//          thumbnailUrl, gradient, description }
// `thumbnailUrl` is null here; the <Thumbnail> placeholder renders `gradient`
// until real frames exist. `relevanceScore` (0–1) is a fake stand-in for the
// future ranking model — the feed sorts on it.

// Subject -> Geist accent scale. Drives tag + placeholder colors.
export const SUBJECTS = [
  { id: 'quantum', name: 'Quantum Computing', accent: 'blue' },
  { id: 'orgchem', name: 'Organic Chemistry', accent: 'green' },
  { id: 'macro', name: 'Macroeconomics', accent: 'amber' },
  { id: 'linalg', name: 'Linear Algebra', accent: 'purple' },
]

// hex pairs per accent for the placeholder gradient (from design.md scales)
const GRADIENTS = {
  blue: ['#48aeff', '#0059ec'],
  green: ['#4ce15e', '#107d32'],
  amber: ['#ffc543', '#ff9300'],
  purple: ['#c979ff', '#7d00cc'],
}

const raw = [
  {
    id: 'c1',
    title: 'Superposition in 60 Seconds',
    channel: 'MinutePhysics',
    subjectTag: 'Quantum Computing',
    durationSec: 58,
    relevanceScore: 0.97,
    description: 'Why a qubit holds 0 and 1 at once — and what collapse really means.',
  },
  {
    id: 'c2',
    title: 'Entanglement, No Equations',
    channel: 'Quanta Magazine',
    subjectTag: 'Quantum Computing',
    durationSec: 44,
    relevanceScore: 0.88,
    description: 'Spooky action at a distance, explained with two coins.',
  },
  {
    id: 'c3',
    title: 'Reading a Quantum Circuit',
    channel: 'Qiskit',
    subjectTag: 'Quantum Computing',
    durationSec: 72,
    relevanceScore: 0.74,
    description: 'Gates, wires, and measurement — left to right.',
  },
  {
    id: 'c4',
    title: 'SN1 vs SN2 in One Diagram',
    channel: 'Organic Chemistry Tutor',
    subjectTag: 'Organic Chemistry',
    durationSec: 65,
    relevanceScore: 0.93,
    description: 'Pick the mechanism from substrate and solvent alone.',
  },
  {
    id: 'c5',
    title: 'Why Benzene Is Flat',
    channel: 'CrashCourse',
    subjectTag: 'Organic Chemistry',
    durationSec: 51,
    relevanceScore: 0.81,
    description: 'Aromaticity and the delocalized pi cloud, fast.',
  },
  {
    id: 'c6',
    title: 'Chair Flips Without Tears',
    channel: 'Leah4Sci',
    subjectTag: 'Organic Chemistry',
    durationSec: 78,
    relevanceScore: 0.69,
    description: 'Axial to equatorial on cyclohexane, step by step.',
  },
  {
    id: 'c7',
    title: 'What Moves the Interest Rate',
    channel: 'Marginal Revolution U',
    subjectTag: 'Macroeconomics',
    durationSec: 60,
    relevanceScore: 0.9,
    description: 'Supply and demand for loanable funds in 1 minute.',
  },
  {
    id: 'c8',
    title: 'GDP Is Not Welfare',
    channel: 'Economics Explained',
    subjectTag: 'Macroeconomics',
    durationSec: 47,
    relevanceScore: 0.78,
    description: 'What the headline number leaves out.',
  },
  {
    id: 'c9',
    title: 'Inflation, Drawn Out',
    channel: 'CrashCourse',
    subjectTag: 'Macroeconomics',
    durationSec: 55,
    relevanceScore: 0.66,
    description: 'Too much money chasing too few goods — visualized.',
  },
  {
    id: 'c10',
    title: 'Eigenvectors, Visually',
    channel: '3Blue1Brown',
    subjectTag: 'Linear Algebra',
    durationSec: 69,
    relevanceScore: 0.95,
    description: 'The vectors a transform only stretches, never turns.',
  },
  {
    id: 'c11',
    title: 'Determinant = Area Scale',
    channel: '3Blue1Brown',
    subjectTag: 'Linear Algebra',
    durationSec: 42,
    relevanceScore: 0.84,
    description: 'What the number actually measures about a matrix.',
  },
  {
    id: 'c12',
    title: 'Dot Product, Two Ways',
    channel: 'Khan Academy',
    subjectTag: 'Linear Algebra',
    durationSec: 63,
    relevanceScore: 0.71,
    description: 'Projection and components give the same answer.',
  },
]

const accentFor = (subjectTag) =>
  SUBJECTS.find((s) => s.name === subjectTag)?.accent ?? 'blue'

export const CLIPS = raw.map((c) => ({
  ...c,
  thumbnailUrl: null,
  accent: accentFor(c.subjectTag),
  gradient: GRADIENTS[accentFor(c.subjectTag)],
}))

export const formatDuration = (sec) => {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// Ranking stand-in: highest fake relevance first.
export function getFeedClips(subjects) {
  const active = subjects && subjects.length ? new Set(subjects) : null
  return CLIPS.filter((c) => !active || active.has(c.subjectTag)).sort(
    (a, b) => b.relevanceScore - a.relevanceScore,
  )
}
