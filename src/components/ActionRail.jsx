import { useState } from 'react'

// Reels-style vertical action rail. Like + Save feed the recommender; Share is cosmetic.
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
      {count != null && (
        <span className="font-mono text-[12px] leading-4 text-white drop-shadow">{count}</span>
      )}
    </button>
  )
}

export default function ActionRail({ clip, onLike, onSaveLesson, onSaveError }) {
  const [liked, setLiked] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  // Like is a real signal: liking nudges the recommender's style fit toward this clip.
  const onLikeClick = () => {
    setLiked((v) => {
      if (!v) onLike?.(clip) // only fire on like (not unlike)
      return !v
    })
  }

  // Save persists the lesson to the memory graph AND is a strong recommender signal.
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
      <RailButton label="Like" active={liked} activeColor="text-red-700" onClick={onLikeClick}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} className={liked ? 'animate-pop' : ''}>
          <path
            d="M12 21s-7.5-4.6-10-9.3C.4 8.3 2 5 5.2 5c2 0 3.3 1.1 4.1 2.3l.7 1 .7-1C11.5 6.1 12.8 5 14.8 5 18 5 19.6 8.3 18 11.7 15.5 16.4 12 21 12 21Z"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      </RailButton>

      <RailButton
        label="Commit to memory"
        count={saving ? 'Saving…' : saved ? 'Saved ✓' : 'Memory'}
        active={saved}
        activeColor="text-accent-500"
        onClick={onSave}
      >
        {saving ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="animate-spin">
            <path d="M12 3a9 9 0 1 0 9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : (
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" className={saved ? 'animate-pop' : ''}>
            <circle cx="6" cy="6" r="2.5" stroke="currentColor" strokeWidth="2" fill={saved ? 'currentColor' : 'none'} />
            <circle cx="18" cy="9" r="2.5" stroke="currentColor" strokeWidth="2" fill={saved ? 'currentColor' : 'none'} />
            <circle cx="9" cy="18" r="2.5" stroke="currentColor" strokeWidth="2" fill={saved ? 'currentColor' : 'none'} />
            <path d="M8 7.5l8 1M8 8l1 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
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
