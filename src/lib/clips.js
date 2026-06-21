// Maps an API clip into the shape the UI components expect, and assigns a
// deterministic Geist accent + gradient from the clip's subject/tag so the feed
// stays colorful (the real ranking/subject model is a later stage).

const ACCENTS = ['blue', 'green', 'amber', 'purple']

const GRADIENTS = {
  blue: ['#48aeff', '#0059ec'],
  green: ['#4ce15e', '#107d32'],
  amber: ['#ffc543', '#ff9300'],
  purple: ['#c979ff', '#7d00cc'],
}

function hashStr(s) {
  let h = 0
  for (const ch of String(s || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return h
}

export function accentFor(key) {
  return ACCENTS[hashStr(key) % ACCENTS.length]
}

export function formatDuration(sec) {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function titleCase(s) {
  return String(s || '').replace(/\b\w/g, (m) => m.toUpperCase())
}

export function decorateClip(c) {
  const subject = c.subject || (c.tags && c.tags[0]) || 'Clip'
  const accent = accentFor(subject)
  return {
    id: c.id,
    title: c.title || 'Untitled clip',
    channel: c.channel || 'Clip',
    subjectTag: titleCase(subject),
    durationSec: Math.round(c.duration || 0),
    start: typeof c.start === 'number' ? c.start : 0,
    end: typeof c.end === 'number' ? c.end : c.duration || 0,
    relevanceScore: typeof c.score === 'number' ? c.score : 0,
    description: c.summary || c.hook || '',
    videoUrl: c.video_url,
    thumbnailUrl: null,
    accent,
    gradient: GRADIENTS[accent],
    tags: c.tags || [],
    jobId: c.job_id,
  }
}
