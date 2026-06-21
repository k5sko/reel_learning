// Thin client for the memory backend (served by Vite middleware in dev, or a
// standalone Node server in prod). All persistence + reasoning happens server
// side; the UI only sends lesson context and renders the returned graph.

const BASE = '/api/memory'

async function req(path, opts = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  })
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.json()).error
    } catch {
      /* ignore */
    }
    throw new Error(detail || `request failed (${res.status})`)
  }
  return res.json()
}

export const getGraph = () => req('/graph')

export const resetGraph = () => req('/reset', { method: 'POST' })

// lesson: { title, subject, channel, description, interests[] }
export const saveLesson = (lesson) =>
  req('/save', { method: 'POST', body: JSON.stringify(lesson) })
