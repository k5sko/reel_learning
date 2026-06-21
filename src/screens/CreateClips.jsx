import { useEffect, useRef, useState } from 'react'
import { createJob, getJob, getQuestionnaire, startLearning, uploadVideo } from '../api.js'
import JobProgress from '../components/JobProgress.jsx'
import Questionnaire from './Questionnaire.jsx'

// Screen 1 — three ways in. Topic runs a short flashcard intake, then fetches +
// clips MULTIPLE targeted videos concurrently. YouTube link / Upload do one video.
const MODES = [
  { id: 'topic', label: 'Topic' },
  { id: 'youtube', label: 'YouTube link' },
  { id: 'upload', label: 'Upload MP4' },
]

export default function CreateClips({ libraryCount = 0, onDone, onBrowse }) {
  const [mode, setMode] = useState('topic')
  const [topic, setTopic] = useState('')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState(null)

  const [phase, setPhase] = useState('input') // input | quiz | work
  const [loadingQuiz, setLoadingQuiz] = useState(false)
  const [questions, setQuestions] = useState([])
  const [jobs, setJobs] = useState([]) // [{job_id, video?, query?, stage, error}]
  const [profile, setProfile] = useState('')
  const [error, setError] = useState(null)
  const [clarify, setClarify] = useState(null)
  const cancelled = useRef(false)

  useEffect(() => {
    // Reset on (re)mount so StrictMode's mount→unmount→remount doesn't freeze polling.
    cancelled.current = false
    return () => {
      cancelled.current = true
    }
  }, [])
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const resetTransient = () => {
    setError(null)
    setClarify(null)
  }

  // Poll N jobs until all settle, then show the feed of the ones that succeeded.
  const pollJobs = async (initial) => {
    let live = initial.map((j) => ({ ...j, stage: 'queued', error: null }))
    setJobs(live)
    setProfile((p) => p) // keep
    setPhase('work')
    while (!cancelled.current) {
      await sleep(2000)
      live = await Promise.all(
        live.map(async (j) => {
          if (j.stage === 'done' || j.error) return j
          try {
            const s = await getJob(j.job_id)
            return { ...j, stage: s.status, clips: s.clips || 0, error: s.status === 'error' ? s.error || 'failed' : null }
          } catch {
            return j
          }
        }),
      )
      if (cancelled.current) return
      setJobs([...live])
      // Auto-advance once every job has settled (done or errored).
      if (live.every((j) => j.stage === 'done' || j.error)) {
        if (live.some((j) => j.stage === 'done')) await onDone(live.map((j) => j.job_id))
        else setError('Every video failed to process. See the stages above.')
        return
      }
    }
  }

  // --- topic flow: questionnaire -> plan -> multiple videos ---
  const startTopic = async (override) => {
    const q = (override ?? topic).trim()
    if (!q || phase !== 'input' || loadingQuiz) return
    if (override) setTopic(override)
    resetTransient()
    setLoadingQuiz(true)
    try {
      const r = await getQuestionnaire(q)
      if (r.status === 'needs_clarification') {
        setClarify({ message: r.message, suggestions: r.suggestions || [] })
      } else if (r.status === 'questions' && r.questions?.length) {
        setQuestions(r.questions)
        setPhase('quiz')
      } else {
        setError(r.message || 'Could not prepare questions for that topic.')
      }
    } catch (e) {
      setError(String(e.message || e))
    }
    setLoadingQuiz(false)
  }

  const onQuizComplete = async (answers) => {
    resetTransient()
    setJobs([])
    setProfile('')
    setPhase('work')
    try {
      const r = await startLearning(topic, answers)
      if (r.status !== 'started' || !r.jobs?.length) {
        setError(r.message || 'No matching videos found for that.')
        setPhase('input')
        return
      }
      setProfile(r.profile || '')
      await pollJobs(r.jobs)
    } catch (e) {
      setError(String(e.message || e))
      setPhase('input')
    }
  }

  // --- youtube / upload: single video ---
  const runUrl = async () => {
    const u = url.trim()
    if (!u || phase !== 'input') return
    resetTransient()
    try {
      const { job_id } = await createJob(u)
      await pollJobs([{ job_id }])
    } catch (e) {
      setError(String(e.message || e))
      setPhase('input')
    }
  }
  const runUpload = async () => {
    if (!file || phase !== 'input') return
    resetTransient()
    try {
      const { job_id } = await uploadVideo(file)
      await pollJobs([{ job_id, video: { title: file.name } }])
    } catch (e) {
      setError(String(e.message || e))
      setPhase('input')
    }
  }

  const restart = () => {
    setPhase('input')
    setJobs([])
    setProfile('')
    setQuestions([])
    resetTransient()
  }

  // Jump to the feed for this session's videos without waiting for every job —
  // shows whatever clips are ready (a slow/stuck video won't block the rest).
  const openClipsNow = () => onDone(jobs.map((j) => j.job_id))

  const keyHint =
    error && /api_key|x-api-key|authentication|401|ANTHROPIC|GROQ/i.test(error)
      ? 'An API key may be missing/invalid — check ANTHROPIC_API_KEY (and GROQ_API_KEY if using Groq) in clipper/.env, then restart the backend.'
      : null

  // Full-screen flashcard intake.
  if (phase === 'quiz') {
    return (
      <Questionnaire topic={topic} questions={questions} onComplete={onQuizComplete} onBack={restart} />
    )
  }

  const progressMode = mode === 'upload' ? 'upload' : 'youtube'
  const allFailed = phase === 'work' && jobs.length > 0 && jobs.every((j) => j.error)

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 overflow-hidden">
        <div className="animate-blob absolute -left-12 -top-16 h-48 w-48 rounded-full bg-blue-400 opacity-40 blur-3xl" />
        <div className="animate-blob absolute right-0 -top-10 h-44 w-44 rounded-full bg-purple-400 opacity-40 blur-3xl" style={{ animationDelay: '1.5s' }} />
        <div className="animate-blob absolute left-24 top-2 h-40 w-40 rounded-full bg-amber-400 opacity-30 blur-3xl" style={{ animationDelay: '3s' }} />
      </div>

      <div className="relative flex h-full flex-col px-5 pb-5 pt-9">
        <header className="mb-6">
          <p className="mb-2 font-mono text-[13px] text-gray-900">Reel Learning</p>
          <h1 className="text-[34px] font-semibold leading-[40px] tracking-[-1.4px] text-gray-1000">
            Learn anything,
            <br />as a feed of clips.
          </h1>
        </header>

        {phase === 'input' && (
          <>
            {/* mode tabs */}
            <div className="mb-4 flex gap-1 rounded-md bg-gray-100 p-1">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  onClick={() => !loadingQuiz && setMode(m.id)}
                  disabled={loadingQuiz}
                  className={`h-9 flex-1 rounded-sm text-[13px] font-medium transition-colors duration-150 ease-geist disabled:opacity-50 ${
                    mode === m.id ? 'bg-bg-100 text-gray-1000 shadow-raised' : 'text-gray-900 hover:text-gray-1000'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {mode === 'topic' && (
              <>
                <div className="flex gap-2">
                  <input
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && startTopic()}
                    placeholder="What do you want to learn? e.g. the chain rule"
                    disabled={loadingQuiz}
                    className="h-12 flex-1 rounded-sm border border-gray-a-400 bg-bg-100 px-3 text-[16px] leading-5 text-gray-1000 shadow-raised placeholder:text-gray-700 disabled:bg-gray-100"
                  />
                  <button
                    onClick={() => startTopic()}
                    disabled={!topic.trim() || loadingQuiz}
                    className="h-12 rounded-sm bg-gray-1000 px-4 text-[16px] font-medium text-bg-100 transition-colors duration-150 ease-geist hover:bg-gray-900 disabled:bg-gray-100 disabled:text-gray-700"
                  >
                    {loadingQuiz ? '…' : 'Start'}
                  </button>
                </div>
                <p className="mt-2 text-[12px] leading-4 text-gray-700">
                  A few quick questions, then we fetch & clip several targeted videos.
                </p>
              </>
            )}

            {mode === 'youtube' && (
              <div className="flex gap-2">
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && runUrl()}
                  placeholder="https://youtube.com/watch?v=…"
                  className="h-12 flex-1 rounded-sm border border-gray-a-400 bg-bg-100 px-3 text-[16px] leading-5 text-gray-1000 shadow-raised placeholder:text-gray-700"
                />
                <button
                  onClick={runUrl}
                  disabled={!url.trim()}
                  className="h-12 rounded-sm bg-gray-1000 px-4 text-[16px] font-medium text-bg-100 transition-colors duration-150 ease-geist hover:bg-gray-900 disabled:bg-gray-100 disabled:text-gray-700"
                >
                  Generate
                </button>
              </div>
            )}

            {mode === 'upload' && (
              <div className="flex flex-col gap-2">
                <label className="flex h-24 cursor-pointer items-center justify-center rounded-md border border-dashed border-gray-a-400 bg-bg-100 text-center text-[14px] text-gray-900 hover:bg-gray-100">
                  <input
                    type="file"
                    accept="video/mp4,video/*"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                  {file ? `Selected: ${file.name}` : 'Choose an MP4 file…'}
                </label>
                <button
                  onClick={runUpload}
                  disabled={!file}
                  className="h-12 rounded-sm bg-gray-1000 px-4 text-[16px] font-medium text-bg-100 transition-colors duration-150 ease-geist hover:bg-gray-900 disabled:bg-gray-100 disabled:text-gray-700"
                >
                  Generate
                </button>
              </div>
            )}

            <div className="mt-5 flex-1 overflow-y-auto no-scrollbar">
              {loadingQuiz && (
                <div className="flex items-center gap-3 rounded-md border border-gray-a-200 bg-bg-100 p-4 shadow-raised">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-1000" />
                  <p className="text-[14px] font-medium text-gray-1000">Tailoring a few questions…</p>
                </div>
              )}

              {clarify && (
                <div className="rounded-md border border-amber-400 bg-amber-100 p-4">
                  <p className="text-[14px] leading-5 text-amber-900">{clarify.message}</p>
                  {clarify.suggestions.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-2">
                      {clarify.suggestions.map((s) => (
                        <button
                          key={s}
                          onClick={() => startTopic(s)}
                          className="rounded-full border border-amber-600/40 bg-bg-100 px-3 py-1 text-[13px] text-amber-900 transition-colors duration-150 ease-geist hover:bg-amber-100"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {error && (
                <div className="rounded-md border border-red-400 bg-red-100 p-4">
                  <p className="text-[14px] font-medium text-red-900">Couldn’t start</p>
                  <p className="mt-1 break-words text-[13px] leading-5 text-red-900/90">{error}</p>
                  {keyHint && <p className="mt-2 text-[13px] leading-5 text-red-900/90">{keyHint}</p>}
                </div>
              )}
            </div>
          </>
        )}

        {phase === 'work' && (
          <div className="mt-1 flex flex-1 flex-col overflow-y-auto no-scrollbar">
            <p className="mb-1 font-mono text-[12px] uppercase tracking-wide text-gray-700">
              {jobs.length === 0
                ? `Finding videos for “${topic}”`
                : `Building your feed · ${jobs.length} video${jobs.length === 1 ? '' : 's'}`}
            </p>
            {profile && <p className="mb-4 text-[14px] leading-5 text-gray-900">{profile}</p>}

            {jobs.length === 0 && !error && (
              <div className="flex items-center gap-3 rounded-md border border-gray-a-200 bg-bg-100 p-4 shadow-raised">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-1000" />
                <p className="text-[14px] font-medium text-gray-1000">
                  Searching channels & picking the best videos…
                </p>
              </div>
            )}

            <div className="flex flex-col gap-3.5">
              {jobs.map((j, i) => (
                <div key={j.job_id}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-gray-1000 text-[11px] font-semibold text-bg-100">
                      {i + 1}
                    </span>
                    <span className="truncate text-[14px] font-medium text-gray-1000">
                      {j.video?.title || 'Video'}
                    </span>
                  </div>
                  <JobProgress mode={progressMode} stage={j.stage} error={j.error} />
                </div>
              ))}
            </div>

            {error && (
              <div className="mt-3 rounded-md border border-red-400 bg-red-100 p-3">
                <p className="break-words text-[13px] leading-5 text-red-900/90">{error}</p>
                {keyHint && <p className="mt-1.5 text-[13px] leading-5 text-red-900/90">{keyHint}</p>}
              </div>
            )}

            {/* Jump in as soon as any clips are ready — no waiting on a slow video */}
            {jobs.some((j) => (j.clips || 0) > 0 || j.stage === 'done') && (
              <button
                onClick={openClipsNow}
                className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-sm bg-gray-1000 text-[16px] font-medium text-bg-100 transition-colors duration-150 ease-geist hover:bg-gray-900"
              >
                Open clips
                <span className="rounded-full bg-bg-100/20 px-2 py-0.5 font-mono text-[12px]">
                  {jobs.reduce((n, j) => n + (j.clips || 0), 0)}
                </span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}

            {allFailed && (
              <button
                onClick={restart}
                className="mt-4 h-11 rounded-sm border border-gray-a-400 bg-bg-100 text-[15px] font-medium text-gray-1000 hover:bg-gray-100"
              >
                Try a different topic
              </button>
            )}
          </div>
        )}

        {libraryCount > 0 && phase === 'input' && !loadingQuiz && (
          <button
            onClick={onBrowse}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-sm border border-gray-a-400 bg-bg-100 text-[16px] font-medium text-gray-1000 transition-colors duration-150 ease-geist hover:bg-gray-100"
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
