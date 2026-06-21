import { useState } from 'react'

// Flashcard intake — one tailored question per card, tap an option to advance.
// Answers feed the multi-video learning plan.
const LETTERS = ['A', 'B', 'C', 'D', 'E']

export default function Questionnaire({ topic, questions, onComplete, onBack }) {
  const [idx, setIdx] = useState(0)
  const [answers, setAnswers] = useState({})
  const [picked, setPicked] = useState(null)

  const q = questions[idx]
  const total = questions.length

  const choose = (opt) => {
    if (picked) return
    setPicked(opt)
    const next = { ...answers, [q.id]: opt }
    setAnswers(next)
    // brief highlight, then advance (or finish)
    setTimeout(() => {
      setPicked(null)
      if (idx + 1 < total) setIdx(idx + 1)
      else onComplete(next)
    }, 240)
  }

  const goBack = () => {
    if (picked) return
    if (idx === 0) return onBack()
    setIdx(idx - 1)
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* ambient blobs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="animate-blob absolute -left-16 top-10 h-52 w-52 rounded-full bg-blue-400 opacity-30 blur-3xl" />
        <div className="animate-blob absolute -right-10 top-1/3 h-48 w-48 rounded-full bg-purple-400 opacity-30 blur-3xl" style={{ animationDelay: '1.8s' }} />
        <div className="animate-blob absolute bottom-8 left-16 h-44 w-44 rounded-full bg-amber-400 opacity-20 blur-3xl" style={{ animationDelay: '3.2s' }} />
      </div>

      <div className="relative flex h-full flex-col px-5 pb-6 pt-9">
        {/* header: back + progress */}
        <div className="mb-8 flex items-center gap-3">
          <button
            onClick={goBack}
            aria-label="Back"
            className="grid h-9 w-9 place-items-center rounded-full text-gray-1000 transition-colors duration-150 ease-geist hover:bg-gray-a-100"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="flex flex-1 items-center gap-1.5">
            {questions.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ease-geist ${
                  i < idx ? 'bg-gray-1000' : i === idx ? 'bg-gray-700' : 'bg-gray-200'
                }`}
              />
            ))}
          </div>
          <span className="font-mono text-[12px] text-gray-700">
            {idx + 1}/{total}
          </span>
        </div>

        {/* the card — re-animates per question */}
        <div key={idx} className="flex flex-1 flex-col animate-fade-up">
          <p className="mb-2 font-mono text-[12px] uppercase tracking-wide text-gray-700">
            Tuning your feed · {topic}
          </p>
          <h2 className="mb-7 text-[26px] font-semibold leading-[32px] tracking-[-1px] text-gray-1000">
            {q.prompt}
          </h2>

          <div className="flex flex-col gap-2.5">
            {q.options.map((opt, i) => {
              const active = picked === opt
              return (
                <button
                  key={opt}
                  onClick={() => choose(opt)}
                  className={`group flex items-center gap-3 rounded-md border px-4 py-3.5 text-left transition-all duration-150 ease-geist ${
                    active
                      ? 'border-gray-1000 bg-gray-1000 text-bg-100'
                      : 'border-gray-a-300 bg-bg-100/80 text-gray-1000 backdrop-blur-sm hover:border-gray-a-500 hover:bg-bg-100'
                  }`}
                >
                  <span
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-semibold transition-colors duration-150 ${
                      active ? 'bg-bg-100 text-gray-1000' : 'bg-gray-100 text-gray-900 group-hover:bg-gray-200'
                    }`}
                  >
                    {LETTERS[i]}
                  </span>
                  <span className="text-[15px] font-medium leading-5">{opt}</span>
                </button>
              )
            })}
          </div>
        </div>

        <p className="mt-4 text-center text-[12px] text-gray-700">
          Your answers pick which videos we fetch and clip.
        </p>
      </div>
    </div>
  )
}
