import { useEffect, useMemo, useState } from 'react'
import { listClips, generatePractice } from '../api.js'
import { decorateClip, accentFor } from '../lib/clips.js'

// Practice tab — pick a subject (from your library or any custom topic), get
// LLM-generated multiple-choice questions, answer one at a time with instant
// feedback + explanation, and see a score at the end. Decoupled from the recsys
// recommender: grounding context = titles/summaries of the subject's own clips.

const ACCENT_DOT = {
  blue: 'bg-blue-700',
  green: 'bg-green-700',
  amber: 'bg-amber-700',
  purple: 'bg-purple-700',
}

const DIFFICULTY = {
  easy: 'border-green-700/40 text-green-700',
  medium: 'border-amber-700/40 text-amber-700',
  hard: 'border-red-700/40 text-red-700',
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

// Group the library into distinct subjects, each carrying a few clip
// titles/summaries to ground the question generator.
function deriveSubjects(decorated) {
  const map = new Map()
  for (const c of decorated) {
    const key = c.subjectTag
    if (!key) continue
    if (!map.has(key)) map.set(key, { subject: key, count: 0, accent: accentFor(key), context: [] })
    const s = map.get(key)
    s.count += 1
    if (s.context.length < 6) {
      const ctx = c.description ? `${c.title} — ${c.description}` : c.title
      if (ctx) s.context.push(ctx)
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count)
}

export default function Practice() {
  const [decorated, setDecorated] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [topic, setTopic] = useState('')

  // Quiz state.
  const [phase, setPhase] = useState('pick') // pick | loading | quiz | done
  const [active, setActive] = useState(null) // { subject, context }
  const [questions, setQuestions] = useState([])
  const [idx, setIdx] = useState(0)
  const [picked, setPicked] = useState(null) // selected option index for current Q
  const [correct, setCorrect] = useState(0)
  const [genError, setGenError] = useState(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await listClips()
        if (!alive) return
        setDecorated((res.clips || []).map(decorateClip))
      } catch (e) {
        if (alive) setLoadError(String(e.message || e))
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const subjects = useMemo(() => (decorated ? deriveSubjects(decorated) : []), [decorated])

  async function start(subject, context = []) {
    setActive({ subject, context })
    setPhase('loading')
    setGenError(null)
    try {
      const res = await generatePractice(subject, context, 5)
      const qs = (res && res.questions) || []
      if (!qs.length) {
        setGenError('Couldn’t write questions for that. Try another topic.')
        setPhase('pick')
        return
      }
      setQuestions(qs)
      setIdx(0)
      setPicked(null)
      setCorrect(0)
      setPhase('quiz')
    } catch (e) {
      setGenError(String(e.message || e))
      setPhase('pick')
    }
  }

  function choose(i) {
    if (picked != null) return // locked once answered
    setPicked(i)
    if (i === questions[idx].answer_index) setCorrect((c) => c + 1)
  }

  function next() {
    if (idx + 1 >= questions.length) {
      setPhase('done')
      return
    }
    setIdx((n) => n + 1)
    setPicked(null)
  }

  function reset() {
    setPhase('pick')
    setActive(null)
    setQuestions([])
    setIdx(0)
    setPicked(null)
    setCorrect(0)
  }

  // ---- Quiz ----------------------------------------------------------------
  if (phase === 'quiz') {
    const q = questions[idx]
    const answered = picked != null
    const diff = DIFFICULTY[q.difficulty] || DIFFICULTY.medium
    return (
      <div className="no-scrollbar flex h-full flex-col overflow-y-auto px-6 pb-8 pt-12">
        <div className="mb-5 flex items-center justify-between">
          <button onClick={reset} className="text-[13px] font-medium text-gray-700 hover:text-gray-1000">
            ← Exit
          </button>
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-gray-700">
            {idx + 1} / {questions.length}
          </span>
        </div>

        {/* progress rail */}
        <div className="mb-6 flex gap-1.5">
          {questions.map((_, i) => (
            <span
              key={i}
              className={`h-1 flex-1 rounded-full ${i < idx || (i === idx && answered) ? 'bg-accent-500' : i === idx ? 'bg-gray-500' : 'bg-gray-300'}`}
            />
          ))}
        </div>

        <div className="mb-1 flex items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-accent-600">{active?.subject}</span>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${diff}`}>
            {q.difficulty}
          </span>
        </div>
        <h2 className="font-head mb-6 text-[22px] font-semibold leading-7 tracking-[-0.5px] text-gray-1000">
          {q.prompt}
        </h2>

        <div className="flex flex-col gap-2.5">
          {q.options.map((opt, i) => {
            const isAnswer = i === q.answer_index
            const isPicked = i === picked
            let cls = 'border-gray-a-200 bg-bg-100 hover:border-gray-400'
            if (answered) {
              if (isAnswer) cls = 'border-green-700 bg-green-700/12 text-gray-1000'
              else if (isPicked) cls = 'border-red-700 bg-red-700/12 text-gray-1000'
              else cls = 'border-gray-a-200 bg-bg-100 opacity-55'
            }
            return (
              <button
                key={i}
                onClick={() => choose(i)}
                disabled={answered}
                className={`flex items-start gap-3 rounded-lg border p-3.5 text-left transition-colors duration-150 ease-geist ${cls}`}
              >
                <span
                  className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[12px] font-semibold ${
                    answered && isAnswer
                      ? 'bg-green-700 text-bg-200'
                      : answered && isPicked
                        ? 'bg-red-700 text-bg-200'
                        : 'bg-gray-200 text-gray-900'
                  }`}
                >
                  {answered && isAnswer ? '✓' : answered && isPicked ? '✕' : LETTERS[i]}
                </span>
                <span className="pt-0.5 text-[15px] leading-5 text-gray-1000">{opt}</span>
              </button>
            )
          })}
        </div>

        {answered && (
          <div className="mt-5 rounded-lg border border-gray-a-200 bg-gray-100 p-4">
            <p className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-gray-700">
              {picked === q.answer_index ? 'Correct' : 'Not quite'}
            </p>
            <p className="text-[14px] leading-5 text-gray-900">{q.explanation}</p>
          </div>
        )}

        <div className="mt-auto pt-6">
          <button
            onClick={next}
            disabled={!answered}
            className="h-12 w-full rounded-sm bg-gray-1000 text-[15px] font-medium text-bg-100 transition-colors duration-150 ease-geist hover:bg-gray-900 disabled:opacity-40"
          >
            {idx + 1 >= questions.length ? 'See results' : 'Next question'}
          </button>
        </div>
      </div>
    )
  }

  // ---- Results -------------------------------------------------------------
  if (phase === 'done') {
    const total = questions.length
    const pct = total ? Math.round((correct / total) * 100) : 0
    const verdict =
      pct >= 80 ? 'Sharp — you’ve got this.' : pct >= 50 ? 'Solid. A bit more reps.' : 'Worth another pass.'
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 pb-8 text-center">
        <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-gray-700">{active?.subject}</p>
        <div className="font-head text-[64px] font-semibold leading-none tracking-[-2px] text-gray-1000 tabular-nums">
          {correct}
          <span className="text-gray-600">/{total}</span>
        </div>
        <p className="mt-3 text-[15px] font-medium text-gray-900">{verdict}</p>

        <div className="mt-10 flex w-full max-w-[300px] flex-col gap-2.5">
          <button
            onClick={() => start(active.subject, active.context)}
            className="h-12 w-full rounded-sm bg-gray-1000 text-[15px] font-medium text-bg-100 transition-colors duration-150 ease-geist hover:bg-gray-900"
          >
            Practice again
          </button>
          <button
            onClick={reset}
            className="h-11 w-full rounded-sm border border-gray-a-200 text-[14px] font-medium text-gray-900 hover:bg-gray-a-100"
          >
            Pick another subject
          </button>
        </div>
      </div>
    )
  }

  // ---- Loading -------------------------------------------------------------
  if (phase === 'loading') {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <span className="mb-4 h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-1000" />
        <p className="text-[15px] font-medium text-gray-1000">Writing your quiz…</p>
        <p className="mt-1 text-[13px] text-gray-700">on {active?.subject}</p>
      </div>
    )
  }

  // ---- Pick ----------------------------------------------------------------
  const custom = topic.trim()
  return (
    <div className="no-scrollbar h-full overflow-y-auto px-6 pb-8 pt-12">
      <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-gray-700">Practice</p>
      <h1 className="font-head mb-2 text-[30px] font-semibold leading-9 tracking-[-1px] text-gray-1000">
        Test what you know
      </h1>
      <p className="mb-7 text-[14px] leading-5 text-gray-700">
        Pick a subject from your library, or quiz yourself on anything.
      </p>

      {genError && (
        <div className="mb-5 rounded-md border border-red-400 bg-red-100 p-3.5 text-[13px] leading-5 text-red-900">
          {genError}
        </div>
      )}

      {/* custom topic */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (custom) start(custom, [])
        }}
        className="mb-8"
      >
        <div className="flex gap-2">
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Any topic — e.g. Bayes’ theorem"
            className="h-12 flex-1 rounded-sm border border-gray-a-200 bg-bg-100 px-3.5 text-[15px] text-gray-1000 placeholder:text-gray-600 focus:border-accent-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!custom}
            className="h-12 shrink-0 rounded-sm bg-gray-1000 px-5 text-[15px] font-medium text-bg-100 transition-colors duration-150 ease-geist hover:bg-gray-900 disabled:opacity-40"
          >
            Quiz me
          </button>
        </div>
      </form>

      {loadError && (
        <p className="text-[13px] text-gray-700">Couldn’t load your library. {loadError}</p>
      )}

      {decorated && subjects.length > 0 && (
        <>
          <p className="mb-2.5 text-[13px] font-medium text-gray-900">From your library</p>
          <div className="flex flex-col gap-2.5">
            {subjects.map((s) => (
              <button
                key={s.subject}
                onClick={() => start(s.subject, s.context)}
                className="group flex items-center gap-3.5 rounded-lg border border-gray-a-200 bg-bg-100 p-4 text-left shadow-raised transition-colors duration-150 ease-geist hover:border-gray-400"
              >
                <span className={`h-9 w-1.5 shrink-0 rounded-full ${ACCENT_DOT[s.accent] || 'bg-accent-500'}`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-gray-1000">{s.subject}</span>
                  <span className="text-[12px] text-gray-700">
                    {s.count} clip{s.count === 1 ? '' : 's'} watched
                  </span>
                </span>
                <span className="text-gray-600 transition-transform duration-150 group-hover:translate-x-0.5">→</span>
              </button>
            ))}
          </div>
        </>
      )}

      {decorated && subjects.length === 0 && !loadError && (
        <p className="text-[13px] leading-5 text-gray-700">
          No clips yet — build a feed in the Learn tab, or quiz yourself on any topic above.
        </p>
      )}

      {!decorated && !loadError && (
        <div className="flex items-center gap-3 rounded-md border border-gray-a-200 bg-bg-100 p-4">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-1000" />
          <p className="text-[14px] font-medium text-gray-1000">Loading your subjects…</p>
        </div>
      )}
    </div>
  )
}
