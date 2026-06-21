import { useEffect, useRef, useState } from 'react'
import ClipStage from '../components/ClipStage.jsx'
import ActionRail from '../components/ActionRail.jsx'
import SubjectTag from '../components/SubjectTag.jsx'
import RelevanceBadge from '../components/RelevanceBadge.jsx'
import usePrefersReducedMotion from '../hooks/usePrefersReducedMotion.js'

// Screen 2 — immersive, swipeable reel feed playing the rendered clips.
export default function Feed({
  clips,
  scoped = false,
  focusIndex = 0,
  onOpen,
  onEdit,
  onShowAll,
  onOpenGraph,
  onSaveLesson,
  onSaveError,
  onNeedMore,
  onWatched,
}) {
  const reduced = usePrefersReducedMotion()
  const containerRef = useRef(null)
  const slideRefs = useRef([])
  const [active, setActive] = useState(focusIndex)
  const [playing, setPlaying] = useState(true)
  const [soundOn, setSoundOn] = useState(false)
  const [progress, setProgress] = useState(0)
  const lastProgressRef = useRef(0) // watch fraction of the active clip, for feedback on scroll-past
  const prevActiveRef = useRef(focusIndex)

  useEffect(() => {
    slideRefs.current[focusIndex]?.scrollIntoView({ block: 'start' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio >= 0.6) {
            setActive(Number(e.target.dataset.index))
          }
        }
      },
      { root: containerRef.current, threshold: [0.6] },
    )
    slideRefs.current.forEach((el) => el && io.observe(el))
    return () => io.disconnect()
  }, [clips.length])

  // On slide change: report watch engagement for the clip just left, then ask the recommender for
  // the next one when we've reached the end (one-at-a-time growth). The parent guards re-entrancy.
  useEffect(() => {
    setProgress(0)
    const prev = prevActiveRef.current
    if (prev !== active && clips[prev]) onWatched?.(clips[prev], lastProgressRef.current)
    prevActiveRef.current = active
    lastProgressRef.current = 0
    if (active >= clips.length - 1) onNeedMore?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, clips.length])

  const goTo = (i) =>
    slideRefs.current[i]?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })

  if (clips.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
        <p className="text-[16px] leading-6 text-gray-900">
          No clips yet. Paste a YouTube link to generate some.
        </p>
        <button
          onClick={onEdit}
          className="h-10 rounded-sm bg-gray-1000 px-4 text-[14px] font-medium text-bg-100"
        >
          New Clips
        </button>
      </div>
    )
  }

  return (
    <div className="relative h-full bg-black">
      {/* top chrome */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between p-4">
        <div className="pointer-events-auto flex items-center gap-4 text-[16px] font-semibold text-white">
          <span className="opacity-50">Following</span>
          <span className="relative">
            For You
            <span className="absolute -bottom-1.5 left-1/2 h-0.5 w-5 -translate-x-1/2 rounded-full bg-white" />
          </span>
        </div>
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            onClick={onOpenGraph}
            aria-label="Open memory graph"
            className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white backdrop-blur-sm transition-colors duration-150 ease-geist hover:bg-white/25"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <circle cx="6" cy="6" r="2.5" stroke="currentColor" strokeWidth="2" />
              <circle cx="18" cy="9" r="2.5" stroke="currentColor" strokeWidth="2" />
              <circle cx="9" cy="18" r="2.5" stroke="currentColor" strokeWidth="2" />
              <path d="M8 7.5l8 1M8 8l1 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <button
            onClick={() => setSoundOn((s) => !s)}
            aria-label={soundOn ? 'Mute' : 'Unmute'}
            className="grid h-9 w-9 place-items-center rounded-full bg-white/15 text-white backdrop-blur-sm transition-colors duration-150 ease-geist hover:bg-white/25"
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
          {scoped && (
            <button
              onClick={onShowAll}
              className="flex h-9 items-center rounded-full bg-white/15 px-3 text-[13px] font-medium text-white backdrop-blur-sm transition-colors duration-150 ease-geist hover:bg-white/25"
            >
              All clips
            </button>
          )}
          <button
            onClick={onEdit}
            className="flex h-9 items-center gap-1.5 rounded-full bg-white/15 px-3 text-[13px] font-medium text-white backdrop-blur-sm transition-colors duration-150 ease-geist hover:bg-white/25"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            New
          </button>
        </div>
      </div>

      {/* snap feed */}
      <div ref={containerRef} className="no-scrollbar h-full snap-y snap-mandatory overflow-y-scroll">
        {clips.map((clip, i) => (
          <section
            key={clip.id}
            data-index={i}
            ref={(el) => (slideRefs.current[i] = el)}
            className="relative h-full w-full snap-start snap-always"
          >
            <ClipStage
              clip={clip}
              playing={i === active && playing}
              active={i === active}
              muted={!soundOn}
              onTime={(p) => {
                if (i === active) {
                  setProgress(p)
                  lastProgressRef.current = p
                }
              }}
              onEnded={() => active < clips.length - 1 && goTo(active + 1)}
            >
              {/* tap layer: toggle play */}
              <button
                aria-label={playing ? 'Pause' : 'Play'}
                onClick={() => setPlaying((p) => !p)}
                className="absolute inset-0 z-0"
              />

              {i === active && !playing && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                  <div className="grid h-16 w-16 place-items-center rounded-full bg-black/35 text-white ring-1 ring-white/30 animate-pop">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                </div>
              )}

              <div className="absolute bottom-32 right-3 z-10">
                <ActionRail clip={clip} onSaveLesson={onSaveLesson} onSaveError={onSaveError} />
              </div>

              <div
                className={`absolute inset-x-0 bottom-0 z-10 px-4 pb-7 pr-20 ${
                  i === active && !reduced ? 'animate-fade-up' : ''
                }`}
              >
                <div className="mb-2.5 flex flex-wrap items-center gap-2">
                  <SubjectTag accent={clip.accent}>{clip.subjectTag}</SubjectTag>
                  <RelevanceBadge score={clip.relevanceScore} />
                </div>
                <p className="font-head block text-left text-[20px] font-semibold leading-7 tracking-[-0.4px] text-white">
                  {clip.title}
                </p>
                <p className="mt-1 text-[14px] leading-5 text-white/80">@{clip.channel}</p>
                <p className="mt-1.5 line-clamp-2 text-[14px] leading-5 text-white/65">
                  {clip.description}
                </p>
              </div>

              <div className="absolute inset-x-0 bottom-0 z-20 h-1 bg-white/20">
                <div
                  className="h-full bg-white"
                  style={{ width: `${(i === active ? progress : 0) * 100}%` }}
                />
              </div>
            </ClipStage>
          </section>
        ))}
      </div>

      <div className="pointer-events-none absolute bottom-3 left-4 z-20 font-mono text-[12px] text-white/55">
        {active + 1}/{clips.length} · {scoped ? 'this topic' : 'ranked by score'}
        {clips[active]?.pGood != null && (
          <span className="ml-2 text-white/40">
            · rec g={clips[active].pGood.toFixed(2)} f={clips[active].pFit.toFixed(2)} s=
            {clips[active].recScore != null ? clips[active].recScore.toFixed(2) : '–'}
          </span>
        )}
      </div>
    </div>
  )
}
