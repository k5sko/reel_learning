import { useState } from 'react'
import { SUBJECTS, getFeedClips } from '../data/mockClips.js'
import SubjectTag from '../components/SubjectTag.jsx'
import { DOT_CLASSES } from '../components/accent.js'

const subjectFor = (name) => SUBJECTS.find((s) => s.name === name)
const accentFor = (name) => subjectFor(name)?.accent ?? 'blue'

// Screen 1 — pick subjects to study, then find clips.
export default function SubjectInput({ selected, setSelected, onFind }) {
  const [draft, setDraft] = useState('')
  const count = getFeedClips(selected).length

  const add = (name) => {
    const v = name.trim()
    if (!v || selected.includes(v)) return
    setSelected([...selected, v])
    setDraft('')
  }
  const remove = (name) => setSelected(selected.filter((s) => s !== name))
  const suggestions = SUBJECTS.map((s) => s.name).filter((n) => !selected.includes(n))

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* playful color wash behind the header */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-64 overflow-hidden">
        <div className="animate-blob absolute -left-12 -top-16 h-48 w-48 rounded-full bg-blue-400 opacity-40 blur-3xl" />
        <div className="animate-blob absolute right-0 -top-10 h-44 w-44 rounded-full bg-purple-400 opacity-40 blur-3xl" style={{ animationDelay: '1.5s' }} />
        <div className="animate-blob absolute left-24 top-2 h-40 w-40 rounded-full bg-amber-400 opacity-30 blur-3xl" style={{ animationDelay: '3s' }} />
      </div>

      <div className="relative flex h-full flex-col px-5 pb-5 pt-9">
        <header className="mb-7">
          <p className="mb-2 font-mono text-[13px] text-gray-900">Reel Learning</p>
          <h1 className="text-[34px] font-semibold leading-[40px] tracking-[-1.4px] text-gray-1000">
            Study, but make it
            <br />a feed.
          </h1>
          <p className="mt-2.5 text-[16px] leading-6 text-gray-900">
            Pick your subjects. We’ll spin up a scroll of short, vertical clips.
          </p>
        </header>

        {/* input row */}
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add(draft)}
            placeholder="Add a subject…"
            className="h-12 flex-1 rounded-sm border border-gray-a-400 bg-bg-100 px-3 text-[16px] leading-5 text-gray-1000 shadow-raised placeholder:text-gray-700"
          />
          <button
            onClick={() => add(draft)}
            disabled={!draft.trim()}
            className="h-12 rounded-sm bg-gray-1000 px-4 text-[16px] font-medium text-bg-100 transition-colors duration-150 ease-geist hover:bg-gray-900 disabled:bg-gray-100 disabled:text-gray-700"
          >
            Add
          </button>
        </div>

        {/* suggestions */}
        {suggestions.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-[12px] font-medium uppercase tracking-wide text-gray-700">
              Try one
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((name) => (
                <button
                  key={name}
                  onClick={() => add(name)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-gray-a-400 bg-bg-100 px-3 py-1.5 text-[14px] text-gray-900 transition-colors duration-150 ease-geist hover:-translate-y-0.5 hover:bg-gray-100"
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${DOT_CLASSES[accentFor(name)]}`} />
                  {name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* selected */}
        <div className="mt-7 flex-1 overflow-y-auto no-scrollbar">
          <p className="mb-3 text-[12px] font-medium uppercase tracking-wide text-gray-700">
            Studying ({selected.length})
          </p>
          {selected.length === 0 ? (
            <p className="text-[14px] leading-5 text-gray-700">
              No subjects yet. Add one above to find clips.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {selected.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center gap-2 rounded-full border border-gray-a-400 bg-bg-100 py-1 pl-1 pr-2 shadow-raised"
                >
                  <SubjectTag accent={accentFor(name)}>{name}</SubjectTag>
                  <button
                    onClick={() => remove(name)}
                    aria-label={`Remove ${name}`}
                    className="grid h-5 w-5 place-items-center rounded-full text-gray-700 transition-colors duration-150 ease-geist hover:bg-gray-100 hover:text-gray-1000"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* action */}
        <button
          onClick={onFind}
          disabled={selected.length === 0}
          className="group flex h-12 w-full items-center justify-center gap-2 rounded-sm bg-gray-1000 text-[16px] font-medium text-bg-100 transition-colors duration-150 ease-geist hover:bg-gray-900 disabled:bg-gray-100 disabled:text-gray-700"
        >
          Find Clips
          {selected.length > 0 && (
            <span className="rounded-full bg-white/20 px-2 py-0.5 font-mono text-[12px]">
              {count}
            </span>
          )}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="transition-transform duration-150 ease-geist group-hover:translate-x-0.5">
            <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  )
}
