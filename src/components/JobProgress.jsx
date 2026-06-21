// Stepped progress for a clipping job, driven by the polled job status.
// Shows each pipeline stage as done / active / pending, marks the stage that
// failed in red, and fills a bar by progress.

const PREP_LABEL = { topic: 'Find video', upload: 'Upload file', youtube: 'Queue' }

const stepsFor = (mode) => [
  { key: 'prep', label: PREP_LABEL[mode] || 'Prepare' },
  { key: 'ingesting', label: 'Download & extract audio' },
  { key: 'transcribing', label: 'Transcribe' },
  { key: 'segmenting', label: 'Find self-contained moments' },
  { key: 'labeling', label: 'Title & summarize' },
]

const PREP_STAGES = ['searching', 'uploading', 'queued']

function Icon({ state }) {
  if (state === 'done')
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-green-700">
        <circle cx="12" cy="12" r="10" fill="currentColor" />
        <path d="M8 12.5l2.5 2.5L16 9" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  if (state === 'failed')
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-red-700">
        <circle cx="12" cy="12" r="10" fill="currentColor" />
        <path d="M9 9l6 6M15 9l-6 6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  if (state === 'active')
    return <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-1000" />
  return <span className="h-2 w-2 rounded-full bg-gray-400" />
}

export default function JobProgress({ mode, stage, error }) {
  const steps = stepsFor(mode)
  const done = stage === 'done'
  const failed = !!error
  const cur = done
    ? steps.length
    : PREP_STAGES.includes(stage)
      ? 0
      : Math.max(0, steps.findIndex((s) => s.key === stage))
  const pct = Math.round(((done ? steps.length : cur) / steps.length) * 100)

  const stateOf = (i) => {
    if (done) return 'done'
    if (failed && i === cur) return 'failed'
    if (i < cur) return 'done'
    if (i === cur) return 'active'
    return 'pending'
  }

  return (
    <div className="rounded-md border border-gray-a-200 bg-bg-100 p-4 shadow-raised">
      <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div
          className={`h-full rounded-full transition-all duration-300 ease-geist ${failed ? 'bg-red-700' : 'bg-gray-1000'}`}
          style={{ width: `${failed ? 100 : pct}%` }}
        />
      </div>
      <ul className="flex flex-col gap-2">
        {steps.map((s, i) => {
          const st = stateOf(i)
          return (
            <li key={s.key} className="flex items-center gap-2.5">
              <span className="grid h-[18px] w-[18px] place-items-center">
                <Icon state={st} />
              </span>
              <span
                className={`text-[13px] leading-4 ${
                  st === 'active'
                    ? 'font-medium text-gray-1000'
                    : st === 'failed'
                      ? 'font-medium text-red-900'
                      : st === 'done'
                        ? 'text-gray-900'
                        : 'text-gray-700'
                }`}
              >
                {s.label}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
