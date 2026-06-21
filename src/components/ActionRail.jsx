import { useState } from 'react'

// Reels-style vertical action rail. Cosmetic mock — local toggles only.
function RailButton({ label, count, active, activeColor, onClick, children }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      className="group flex flex-col items-center gap-1"
    >
      <span
        className={`grid h-11 w-11 place-items-center rounded-full bg-black/25 backdrop-blur-sm ring-1 ring-white/15 transition-transform duration-150 ease-geist active:scale-90 group-hover:bg-black/40 ${
          active ? activeColor : 'text-white'
        }`}
      >
        {children}
      </span>
      <span className="font-mono text-[12px] leading-4 text-white drop-shadow">{count}</span>
    </button>
  )
}

export default function ActionRail({ clip, onSaveLesson, onSaveError }) {
  const [liked, setLiked] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  // stable pseudo-counts derived from the clip, nudged by the like toggle
  const base = Math.round(clip.relevanceScore * 1900)
  const likes = (base + (liked ? 1 : 0)).toLocaleString()
  const comments = Math.max(8, Math.round(base / 37))

  // Save persists the lesson to the memory graph (real pipeline, not cosmetic).
  const onSave = async () => {
    if (saving || saved || !onSaveLesson) return
    setSaving(true)
    try {
      await onSaveLesson(clip)
      setSaved(true)
    } catch (e) {
      onSaveError?.(e)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-5">
      <RailButton
        label="Like"
        count={likes}
        active={liked}
        activeColor="text-red-700"
        onClick={() => setLiked((v) => !v)}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} className={liked ? 'animate-pop' : ''}>
          <path
            d="M12 21s-7.5-4.6-10-9.3C.4 8.3 2 5 5.2 5c2 0 3.3 1.1 4.1 2.3l.7 1 .7-1C11.5 6.1 12.8 5 14.8 5 18 5 19.6 8.3 18 11.7 15.5 16.4 12 21 12 21Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      </RailButton>

      <RailButton label="Comment" count={comments}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
          <path
            d="M4 5h16v11H9l-4 3v-3H4z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      </RailButton>

      <RailButton
        label="Save lesson to memory"
        count={saving ? 'Saving…' : saved ? 'Saved' : 'Save'}
        active={saved}
        activeColor="text-amber-700"
        onClick={onSave}
      >
        {saving ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="animate-spin">
            <path d="M12 3a9 9 0 1 0 9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill={saved ? 'currentColor' : 'none'} className={saved ? 'animate-pop' : ''}>
            <path d="M6 3h12v18l-6-4-6 4z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        )}
      </RailButton>

      <RailButton label="Share" count="Share">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M4 12v7h16v-7M12 16V3m0 0 4 4m-4-4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </RailButton>
    </div>
  )
}
