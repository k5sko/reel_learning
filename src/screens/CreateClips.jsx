import { useEffect, useRef, useState } from 'react'
import { checkTopic, createJob, getJob, getQuestionnaire, getStats, startLearning, uploadVideo } from '../api.js'
import JobProgress from '../components/JobProgress.jsx'
import Questionnaire from './Questionnaire.jsx'

// Screen 1 — three ways in. Topic lets you list SEVERAL classes (one box each,
// "+" to add more). HYBRID intake: a single class gets the full flashcard quiz
// (level/goal/focus) like before; add a second box and we switch to a fast
// vagueness-only gate so many classes stay quick. Either way they clip into one
// combined feed. YouTube link / Upload do a single video.
const MODES = [
  { id: 'topic', label: 'Topics' },
  { id: 'youtube', label: 'YouTube link' },
  { id: 'upload', label: 'Upload MP4' },
]

export default function CreateClips({ libraryCount = 0, onDone, onBrowse }) {
  const [mode, setMode] = useState('topic')
  // Each class box: { id, text, state?: 'vague'|'error', clarify?: {message, suggestions} }
  const [topics, setTopics] = useState([{ id: 1, text: '' }])
  const [url, setUrl] = useState('')
  const [file, setFile] = useState(null)

  const [phase, setPhase] = useState('input') // input | quiz | work
  const [checking, setChecking] = useState(false)
  const [questions, setQuestions] = useState([]) // single-class flashcard quiz
  const [quizTopic, setQuizTopic] = useState('') // the class being quizzed
  const [jobs, setJobs] = useState([]) // [{job_id, topic, video?, query?, stage, error}]
  const [note, setNote] = useState('') // e.g. classes we couldn't find videos for
  const [error, setError] = useState(null)
  const [stats, setStats] = useState(null) // transcript-compression savings badge
  const cancelled = useRef(false)
  const nextId = useRef(2)
  const goalsRef = useRef([]) // the topics for this session -> seeds the recsys profile

  useEffect(() => {
    // Reset on (re)mount so StrictMode's mount→unmount→remount doesn't freeze polling.
    cancelled.current = false
    getStats().then(setStats).catch(() => {})
    return () => {
      cancelled.current = true
    }
  }, [])
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  // --- class-box editing ---------------------------------------------------
  const updateTopic = (id, text) =>
    setTopics((ts) => ts.map((t) => (t.id === id ? { ...t, text, state: undefined, clarify: null } : t)))
  const addTopic = () => setTopics((ts) => [...ts, { id: nextId.current++, text: '' }])
  const removeTopic = (id) => setTopics((ts) => (ts.length > 1 ? ts.filter((t) => t.id !== id) : ts))
  const applySuggestion = (id, s) =>
    setTopics((ts) => ts.map((t) => (t.id === id ? { ...t, text: s, state: undefined, clarify: null } : t)))

  // Poll N jobs until all settle, then show the feed of the ones that succeeded.
  const pollJobs = async (initial) => {
    let live = initial.map((j) => ({ ...j, stage: 'queued', error: null }))
    setJobs(live)
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
        if (live.some((j) => j.stage === 'done')) await onDone(live.map((j) => j.job_id), goalsRef.current)
        else setError('Every video failed to process. See the stages above.')
        return
      }
    }
  }

  // Mark one box vague/error with its clarification suggestions.
  const flagBox = (id, clarify, state = 'vague') =>
    setTopics((ts) => ts.map((t) => (t.id === id ? { ...t, state, clarify } : t)))

  // --- topic flow (hybrid) --------------------------------------------------
  // 1 class  -> full intake: clarify if vague, else the flashcard quiz.
  // 2+ classes -> fast vagueness-only gate, then clip every class at once.
  const startTopics = async () => {
    if (phase !== 'input' || checking) return
    const entries = topics.map((t) => ({ id: t.id, text: t.text.trim() })).filter((t) => t.text)
    if (!entries.length) return
    setError(null)
    setNote('')

    // Single class — keep the original tailored intake (clarify + quiz cards).
    if (entries.length === 1) {
      const only = entries[0]
      setChecking(true)
      try {
        const r = await getQuestionnaire(only.text)
        if (r.status === 'needs_clarification') {
          flagBox(only.id, { message: r.message, suggestions: r.suggestions || [] })
        } else if (r.status === 'questions' && r.questions?.length) {
          setQuizTopic(only.text)
          setQuestions(r.questions)
          setPhase('quiz')
        } else {
          // specific but no quiz came back — just clip it directly
          await launchClasses([only.text])
        }
      } catch (e) {
        setError(String(e.message || e))
      }
      setChecking(false)
      return
    }

    // Multiple classes — fast vagueness gate per box, concurrently.
    setChecking(true)
    const checks = await Promise.all(
      entries.map(async (t) => {
        try {
          const r = await checkTopic(t.text)
          return { id: t.id, ok: !!r.specific, clarify: r.specific ? null : { message: r.message, suggestions: r.suggestions || [] } }
        } catch (e) {
          return { id: t.id, ok: false, error: String(e.message || e) }
        }
      }),
    )
    setTopics((ts) =>
      ts.map((t) => {
        const c = checks.find((x) => x.id === t.id)
        if (!c) return t
        if (c.ok) return { ...t, state: undefined, clarify: null }
        if (c.error) return { ...t, state: 'error', clarify: { message: c.error, suggestions: [] } }
        return { ...t, state: 'vague', clarify: c.clarify }
      }),
    )
    setChecking(false)
    if (!checks.every((c) => c.ok)) return // user sharpens the flagged boxes, then re-submits

    await launchClasses(entries.map((t) => t.text))
  }

  // Single-class quiz answers -> plan + clip that one class.
  const onQuizComplete = async (answers) => {
    setError(null)
    setNote('')
    setJobs([])
    setPhase('work')
    goalsRef.current = [quizTopic]
    try {
      const r = await startLearning(quizTopic, answers, 3)
      if (r.status === 'started' && r.jobs?.length) {
        await pollJobs(r.jobs.map((j) => ({ ...j, topic: quizTopic })))
      } else {
        setError(r.message || `Couldn’t find videos for ${quizTopic}.`)
        setPhase('input')
      }
    } catch (e) {
      setError(String(e.message || e))
      setPhase('input')
    }
  }

  // Plan + start clipping jobs for every class at once; merge into one feed.
  const launchClasses = async (classTopics) => {
    setJobs([])
    setNote('')
    setPhase('work')
    goalsRef.current = classTopics
    // Fewer videos per class as the list grows, so the total stays reasonable.
    const maxVideos = Math.max(1, Math.min(3, Math.round(6 / classTopics.length)))
    try {
      const results = await Promise.all(
        classTopics.map(async (topic) => {
          try {
            const r = await startLearning(topic, {}, maxVideos)
            if (r.status === 'started' && r.jobs?.length) return r.jobs.map((j) => ({ ...j, topic }))
            return { missed: topic }
          } catch {
            return { missed: topic }
          }
        }),
      )
      const found = results.filter(Array.isArray).flat()
      const missed = results.filter((r) => !Array.isArray(r)).map((r) => r.missed)
      if (!found.length) {
        setError(`Couldn't find videos for ${missed.join(', ')} on the available channels.`)
        setPhase('input')
        return
      }
      if (missed.length) setNote(`No videos found for: ${missed.join(', ')}`)
      await pollJobs(found)
    } catch (e) {
      setError(String(e.message || e))
      setPhase('input')
    }
  }

  // --- youtube / upload: single video ---------------------------------------
  const runUrl = async () => {
    const u = url.trim()
    if (!u || phase !== 'input') return
    setError(null)
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
    setError(null)
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
    setNote('')
    setError(null)
    setQuestions([])
    setQuizTopic('')
  }

  // Jump to the feed for this session's videos without waiting for every job —
  // shows whatever clips are ready (a slow/stuck video won't block the rest).
  const openClipsNow = () => onDone(jobs.map((j) => j.job_id), goalsRef.current)

  const keyHint =
    error && /api_key|x-api-key|authentication|401|ANTHROPIC|GROQ/i.test(error)
      ? 'An API key may be missing/invalid — check ANTHROPIC_API_KEY (and GROQ_API_KEY if using Groq) in clipper/.env, then restart the backend.'
      : null

  const progressMode = mode === 'upload' ? 'upload' : 'youtube'
  const allFailed = phase === 'work' && jobs.length > 0 && jobs.every((j) => j.error)
  const classCount = new Set(jobs.map((j) => j.topic).filter(Boolean)).size
  const canBuild = topics.some((t) => t.text.trim())

  // Full-screen flashcard intake for the single-class path.
  if (phase === 'quiz') {
    return (
      <Questionnaire topic={quizTopic} questions={questions} onComplete={onQuizComplete} onBack={restart} />
    )
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* quiet-luxury wash: a single muted accent glow + a faint neutral, low
          opacity — restraint over the old tri-color blobs */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-72 overflow-hidden">
        <div className="animate-blob absolute -right-16 -top-24 h-64 w-64 rounded-full bg-accent-400 opacity-20 blur-3xl" />
        <div className="absolute -left-10 -top-16 h-48 w-48 rounded-full bg-gray-300 opacity-40 blur-3xl" />
      </div>

      <div className="relative flex h-full flex-col px-6 pb-6 pt-10">
        <header className="mb-7">
          <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-gray-700">Reel Learning</p>
          <h1 className="font-head text-[33px] font-semibold leading-[39px] tracking-[-1.1px] text-gray-1000">
            Learn all your
            <br />classes, as a feed.
          </h1>
        </header>

        {phase === 'input' && (
          <>
            {/* mode tabs */}
            <div className="mb-4 flex gap-1 rounded-md bg-gray-100 p-1">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  onClick={() => !checking && setMode(m.id)}
                  disabled={checking}
                  className={`h-9 flex-1 rounded-sm text-[13px] font-medium transition-colors duration-150 ease-geist disabled:opacity-50 ${
                    mode === m.id ? 'bg-bg-100 text-gray-1000 shadow-raised' : 'text-gray-900 hover:text-gray-1000'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            {mode === 'topic' && (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex flex-col gap-2 overflow-y-auto no-scrollbar">
                  {topics.map((t, i) => (
                    <div key={t.id}>
                      <div className="flex gap-2">
                        <input
                          value={t.text}
                          onChange={(e) => updateTopic(t.id, e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && startTopics()}
                          placeholder={i === 0 ? 'A class, e.g. the chain rule' : 'Another class…'}
                          disabled={checking}
                          className={`h-12 flex-1 rounded-sm border bg-bg-100 px-3 text-[16px] leading-5 text-gray-1000 shadow-raised placeholder:text-gray-700 disabled:bg-gray-100 ${
                            t.state ? 'border-amber-700/50' : 'border-gray-a-400'
                          }`}
                        />
                        {topics.length > 1 && (
                          <button
                            onClick={() => removeTopic(t.id)}
                            disabled={checking}
                            aria-label="Remove class"
                            className="grid h-12 w-11 shrink-0 place-items-center rounded-sm border border-gray-a-400 bg-bg-100 text-gray-700 transition-colors duration-150 ease-geist hover:bg-gray-100 hover:text-gray-1000 disabled:opacity-50"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                            </svg>
                          </button>
                        )}
                      </div>

                      {t.clarify && (
                        <div className="mt-1.5 rounded-md border border-amber-700/25 bg-amber-700/10 p-3">
                          <p className="text-[13px] leading-5 text-[#d8bd84]">{t.clarify.message}</p>
                          {t.clarify.suggestions?.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {t.clarify.suggestions.map((s) => (
                                <button
                                  key={s}
                                  onClick={() => applySuggestion(t.id, s)}
                                  className="rounded-full border border-amber-700/25 bg-bg-100 px-2.5 py-1 text-[12px] text-[#d8bd84] transition-colors duration-150 ease-geist hover:bg-amber-700/10"
                                >
                                  {s}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}

                  <button
                    onClick={addTopic}
                    disabled={checking}
                    className="flex h-11 items-center justify-center gap-1.5 rounded-sm border border-dashed border-gray-a-400 text-[14px] font-medium text-gray-900 transition-colors duration-150 ease-geist hover:bg-gray-100 hover:text-gray-1000 disabled:opacity-50"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    Add another class
                  </button>
                </div>

                <button
                  onClick={startTopics}
                  disabled={!canBuild || checking}
                  className="mt-3 flex h-12 items-center justify-center gap-2 rounded-sm bg-gray-1000 px-4 text-[16px] font-medium text-bg-100 transition-colors duration-150 ease-geist hover:bg-gray-900 disabled:bg-gray-100 disabled:text-gray-700"
                >
                  {checking ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-bg-100/40 border-t-bg-100" />
                      Checking…
                    </>
                  ) : (
                    'Build my feed'
                  )}
                </button>
                <p className="mt-2 text-[12px] leading-4 text-gray-700">
                  {topics.length > 1
                    ? 'Multiple classes clip at once — vague boxes get a nudge to sharpen.'
                    : 'One class gets a few quick questions to tailor it. Add more to clip several at once.'}
                </p>

                {error && (
                  <div className="mt-3 rounded-md border border-red-400 bg-red-100 p-4">
                    <p className="text-[14px] font-medium text-red-900">Couldn’t start</p>
                    <p className="mt-1 break-words text-[13px] leading-5 text-red-900/90">{error}</p>
                    {keyHint && <p className="mt-2 text-[13px] leading-5 text-red-900/90">{keyHint}</p>}
                  </div>
                )}
              </div>
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

            {/* URL/upload errors render here (topic errors render inline above) */}
            {mode !== 'topic' && error && (
              <div className="mt-5 rounded-md border border-red-400 bg-red-100 p-4">
                <p className="text-[14px] font-medium text-red-900">Couldn’t start</p>
                <p className="mt-1 break-words text-[13px] leading-5 text-red-900/90">{error}</p>
                {keyHint && <p className="mt-2 text-[13px] leading-5 text-red-900/90">{keyHint}</p>}
              </div>
            )}
          </>
        )}

        {phase === 'work' && (
          <div className="mt-1 flex flex-1 flex-col overflow-y-auto no-scrollbar">
            <p className="mb-4 font-mono text-[12px] uppercase tracking-wide text-gray-700">
              {jobs.length === 0
                ? 'Finding videos for your classes'
                : `Building your feed · ${jobs.length} video${jobs.length === 1 ? '' : 's'}` +
                  (classCount > 1 ? ` · ${classCount} classes` : '')}
            </p>

            {note && <p className="mb-3 text-[13px] leading-5 text-[#cda85f]">{note}</p>}

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
                    {j.topic && (
                      <span className="ml-auto shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-900">
                        {j.topic}
                      </span>
                    )}
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
                Try different classes
              </button>
            )}
          </div>
        )}

        {libraryCount > 0 && phase === 'input' && !checking && (
          <button
            onClick={onBrowse}
            className="mt-3 flex h-12 w-full shrink-0 items-center justify-center gap-2 rounded-sm border border-gray-a-400 bg-bg-100 text-[16px] font-medium text-gray-1000 transition-colors duration-150 ease-geist hover:bg-gray-100"
          >
            Browse library
            <span className="rounded-full bg-gray-100 px-2 py-0.5 font-mono text-[12px] text-gray-900">
              {libraryCount}
            </span>
          </button>
        )}

        {/* Token-compression savings — the optimisation, made visible */}
        {phase === 'input' && !checking && stats && stats.saved_tokens > 0 && (
          <div className="mt-3 flex shrink-0 items-center gap-2.5 rounded-sm border border-gray-a-200 bg-bg-100 px-3 py-2.5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="shrink-0 text-accent-500">
              <path d="M13 2L4.5 13.5H11l-1 8.5L19.5 10H13l0-8z" fill="currentColor" />
            </svg>
            <p className="text-[12px] leading-4 text-gray-900">
              <span className="font-semibold text-gray-1000">
                {stats.saved_tokens.toLocaleString()} tokens saved
              </span>{' '}
              · transcripts sent to the LLM are {Math.round(stats.reduction * 100)}% smaller
              <span className="text-gray-700"> (across {stats.jobs} video{stats.jobs === 1 ? '' : 's'})</span>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
