import { useEffect, useRef, useState } from 'react'
import { createJob, getJob } from '../api.js'

// Screen 1 — paste a YouTube URL (or local path) and run the clipper pipeline,
// or browse clips already in the library.
const STAGE_LABEL = {
  queued: 'Queued…',
  ingesting: 'Downloading & extracting audio…',
  transcribing: 'Transcribing…',
  segmenting: 'Finding self-contained moments…',
  rendering: 'Rendering clips…',
  labeling: 'Writing titles & summaries…',
  done: 'Done',
  error: 'Failed',
}

export default function CreateClips({ libraryCount = 0, onDone, onBrowse }) {
  const [url, setUrl] = useState('')
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(null)
  const cancelled = useRef(false)

  useEffect(() => () => (cancelled.current = true), [])

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  const generate = async () => {
    const v = url.trim()
    if (!v || running) return
    setRunning(true)
    setError(null)
    setStatus('queued')
    try {
      const { job_id } = await createJob(v)
      // poll until terminal
      // eslint-disable-next-line no-constant-condition
      while (!cancelled.current) {
        await sleep(2000)
        const job = await getJob(job_id)
        setStatus(job.status)
        if (job.status === 'done') {
          if (!cancelled.current) await onDone()
          return
        }
        if (job.status === 'error') {
          setError(job.error || 'The job failed.')
          setRunning(false)
          return
        }
      }
    } catch (e) {
      setError(String(e.message || e))
      setRunning(false)
    }
  }

  const keyHint =
    error && /api_key|x-api-key|authentication|401|ANTHROPIC/i.test(error)
      ? 'Looks like the Anthropic API key is missing or invalid. Set ANTHROPIC_API_KEY in clipper/.env and restart the backend.'
      : null

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 overflow-hidden">
        <div className="animate-blob absolute -left-12 -top-16 h-48 w-48 rounded-full bg-blue-400 opacity-40 blur-3xl" />
        <div className="animate-blob absolute right-0 -top-10 h-44 w-44 rounded-full bg-purple-400 opacity-40 blur-3xl" style={{ animationDelay: '1.5s' }} />
        <div className="animate-blob absolute left-24 top-2 h-40 w-40 rounded-full bg-amber-400 opacity-30 blur-3xl" style={{ animationDelay: '3s' }} />
      </div>

      <div className="relative flex h-full flex-col px-5 pb-5 pt-9">
        <header className="mb-7">
          <p className="mb-2 font-mono text-[13px] text-gray-900">Reel Learning</p>
          <h1 className="text-[34px] font-semibold leading-[40px] tracking-[-1.4px] text-gray-1000">
            Turn a video into
            <br />a feed of clips.
          </h1>
          <p className="mt-2.5 text-[16px] leading-6 text-gray-900">
            Paste a YouTube link. We transcribe it, find the self-contained moments, and cut clips that never break mid-sentence.
          </p>
        </header>

        <div className="flex gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && generate()}
            placeholder="https://youtube.com/watch?v=…"
            disabled={running}
            className="h-12 flex-1 rounded-sm border border-gray-a-400 bg-bg-100 px-3 text-[16px] leading-5 text-gray-1000 shadow-raised placeholder:text-gray-700 disabled:bg-gray-100"
          />
          <button
            onClick={generate}
            disabled={!url.trim() || running}
            className="h-12 rounded-sm bg-gray-1000 px-4 text-[16px] font-medium text-bg-100 transition-colors duration-150 ease-geist hover:bg-gray-900 disabled:bg-gray-100 disabled:text-gray-700"
          >
            {running ? 'Working…' : 'Generate'}
          </button>
        </div>

        {/* progress / error */}
        <div className="mt-5 flex-1 overflow-y-auto no-scrollbar">
          {running && (
            <div className="flex items-center gap-3 rounded-md border border-gray-a-200 bg-bg-100 p-4 shadow-raised">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-1000" />
              <div>
                <p className="text-[14px] font-medium text-gray-1000">{STAGE_LABEL[status] || 'Working…'}</p>
                <p className="mt-0.5 text-[12px] text-gray-700">
                  Transcribing on Groq and clipping with Claude — usually under a minute for short
                  videos. Longer videos take proportionally more.
                </p>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-md border border-red-400 bg-red-100 p-4">
              <p className="text-[14px] font-medium text-red-900">Couldn’t make clips</p>
              <p className="mt-1 break-words text-[13px] leading-5 text-red-900/90">{error}</p>
              {keyHint && <p className="mt-2 text-[13px] leading-5 text-red-900/90">{keyHint}</p>}
            </div>
          )}

          {!running && !error && (
            <p className="text-[13px] leading-5 text-gray-700">
              Needs an Anthropic API key in <span className="font-mono">clipper/.env</span> and a running backend
              (<span className="font-mono">uvicorn clipper.api:app</span>).
            </p>
          )}
        </div>

        {libraryCount > 0 && (
          <button
            onClick={onBrowse}
            className="group flex h-12 w-full items-center justify-center gap-2 rounded-sm border border-gray-a-400 bg-bg-100 text-[16px] font-medium text-gray-1000 transition-colors duration-150 ease-geist hover:bg-gray-100"
          >
            Browse library
            <span className="rounded-full bg-gray-100 px-2 py-0.5 font-mono text-[12px] text-gray-900">
              {libraryCount}
            </span>
          </button>
        )}
      </div>
    </div>
  )
}
