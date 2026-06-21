// Thin client for the clipper backend (proxied via Vite to :8000).

async function asJson(res) {
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body && body.detail) detail = body.detail
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }
  return res.json()
}

export async function listClips() {
  return asJson(await fetch('/api/clips'))
}

export async function createJob(url) {
  return asJson(
    await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    }),
  )
}

export async function getJob(jobId) {
  return asJson(await fetch(`/api/jobs/${jobId}`))
}
