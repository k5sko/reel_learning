import { useEffect, useState } from 'react'
import ClipStage from '../components/ClipStage.jsx'
import ActionRail from '../components/ActionRail.jsx'
import SubjectTag from '../components/SubjectTag.jsx'
import RelevanceBadge from '../components/RelevanceBadge.jsx'
import { formatDuration } from '../lib/clips.js'

// Screen 3 — focused full-screen player driven by the real clip video.
export default function ClipPlayer({ clip, index, total, onClose, onNavigate }) {
  const [playing, setPlaying] = useState(true)
  const [soundOn, setSoundOn] = useState(true)
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    setProgress(0)
    setPlaying(true)
  }, [clip.id])

  return (
    <div className="relative h-full bg-black">
      <ClipStage
        clip={clip}
        playing={playing}
        active
        muted={!soundOn}
        onTime={setProgress}
        onEnded={() => index < total - 1 && onNavigate(1)}
      >
        {/* tap layer toggles play */}
        <button
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => setPlaying((p) => !p)}
          className="absolute inset-0 z-0"
        />

        {/* top bar */}
        <div className="absolute inset-x-0 top-0 z-20 flex items-center justify-between p-4">
          <button
            onClick={onClose}
            aria-label="Back to feed"
            className="grid h-9 w-9 place-items-center rounded-full bg-black/35 text-white backdrop-blur-sm transition-colors duration-150 ease-geist hover:bg-black/55"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSoundOn((s) => !s)}
              aria-label={soundOn ? 'Mute' : 'Unmute'}
              className="grid h-9 w-9 place-items-center rounded-full bg-black/35 text-white backdrop-blur-sm transition-colors duration-150 ease-geist hover:bg-black/55"
            >
              {soundOn ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
                  <path d="M16 8a5 5 0 010 8M18.5 5.5a9 9 0 010 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
                  <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              )}
            </button>
            <span className="rounded-full bg-black/35 px-2.5 py-1 font-mono text-[12px] text-white backdrop-blur-sm">
              {index + 1} / {total}
            </span>
          </div>
        </div>

        {!playing && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="grid h-16 w-16 place-items-center rounded-full bg-black/35 text-white ring-1 ring-white/30 animate-pop">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        )}

        <div className="absolute bottom-36 right-3 z-10">
          <ActionRail clip={clip} />
        </div>

        <div className="absolute inset-x-0 bottom-0 z-10 px-4 pb-6">
          <div className="mb-2 flex flex-wrap items-center gap-2 pr-20">
            <SubjectTag accent={clip.accent}>{clip.subjectTag}</SubjectTag>
            <RelevanceBadge score={clip.relevanceScore} />
          </div>
          <h1 className="pr-20 text-[20px] font-semibold leading-7 tracking-[-0.4px] text-white">
            {clip.title}
          </h1>
          <p className="mt-1 pr-20 text-[14px] leading-5 text-white/80">@{clip.channel}</p>
          <p className="mt-1.5 pr-20 text-[14px] leading-5 text-white/65">{clip.description}</p>

          <div className="mt-4">
            <div className="h-1 w-full overflow-hidden rounded-full bg-white/25">
              <div className="h-full rounded-full bg-white" style={{ width: `${progress * 100}%` }} />
            </div>
            <div className="mt-1 flex justify-between font-mono text-[12px] text-white/70">
              <span>{formatDuration(Math.round(clip.durationSec * progress))}</span>
              <span>{formatDuration(clip.durationSec)}</span>
            </div>
          </div>

          <div className="mt-3 flex gap-2">
            <button
              onClick={() => onNavigate(-1)}
              disabled={index === 0}
              className="h-10 flex-1 rounded-sm border border-white/25 bg-white/10 text-[14px] font-medium text-white backdrop-blur-sm transition-colors duration-150 ease-geist hover:bg-white/20 disabled:opacity-40"
            >
              ‹ Previous
            </button>
            <button
              onClick={() => onNavigate(1)}
              disabled={index === total - 1}
              className="h-10 flex-1 rounded-sm bg-white text-[14px] font-medium text-gray-1000 transition-colors duration-150 ease-geist hover:bg-white/90 disabled:opacity-40"
            >
              Next ›
            </button>
          </div>
        </div>
      </ClipStage>
    </div>
  )
}
