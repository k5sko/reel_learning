import { useState } from 'react'

// First-open style capture → seeds P(fit) so the feed is personalized from clip 1.
// Axes + poles mirror recsys/style.py AXIS_POLES.
const AXES = [
  { key: 'formality', lo: 'Casual', hi: 'Formal' },
  { key: 'humor', lo: 'Serious', hi: 'Funny' },
  { key: 'pace', lo: 'Slow & thorough', hi: 'Fast & punchy' },
  { key: 'depth', lo: 'Intuitive overview', hi: 'Rigorous depth' },
  { key: 'visual_style', lo: 'Talking head', hi: 'Animated / visual' },
  { key: 'conciseness', lo: 'Leisurely', hi: 'Concise' },
]

export default function Onboarding({ onComplete, onSkip }) {
  const [vals, setVals] = useState(() => Object.fromEntries(AXES.map((a) => [a.key, 50])))
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (busy) return
    setBusy(true)
    const axes = Object.fromEntries(AXES.map((a) => [a.key, vals[a.key] / 100]))
    await onComplete(axes)
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden px-6 pb-6 pt-10">
      <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-accent-400 opacity-20 blur-3xl" />

      <header className="mb-7">
        <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.2em] text-gray-700">
          Reel Learning
        </p>
        <h1 className="font-head text-[30px] font-semibold leading-[36px] tracking-[-1px] text-gray-1000">
          What's your
          <br />learning style?
        </h1>
        <p className="mt-2 text-[14px] leading-5 text-gray-700">
          Tunes which clips we surface. You can change it anytime.
        </p>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto no-scrollbar">
        {AXES.map((a) => (
          <div key={a.key}>
            <div className="mb-1.5 flex justify-between text-[12px] font-medium text-gray-900">
              <span>{a.lo}</span>
              <span>{a.hi}</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={vals[a.key]}
              onChange={(e) => setVals((v) => ({ ...v, [a.key]: Number(e.target.value) }))}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-gray-200 accent-accent-500"
            />
          </div>
        ))}
      </div>

      <button
        onClick={submit}
        disabled={busy}
        className="mt-6 flex h-12 items-center justify-center gap-2 rounded-sm bg-gray-1000 px-4 text-[16px] font-medium text-bg-100 transition-colors duration-150 ease-geist hover:bg-gray-900 disabled:opacity-60"
      >
        {busy ? 'Saving…' : 'Start learning'}
      </button>
      <button
        onClick={onSkip}
        disabled={busy}
        className="mt-2 h-9 text-[13px] font-medium text-gray-700 hover:text-gray-1000 disabled:opacity-60"
      >
        Skip for now
      </button>
    </div>
  )
}
