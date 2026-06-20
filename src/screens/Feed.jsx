import { useEffect, useRef, useState } from 'react'
import ClipStage from '../components/ClipStage.jsx'
import ActionRail from '../components/ActionRail.jsx'
import SubjectTag from '../components/SubjectTag.jsx'
import RelevanceBadge from '../components/RelevanceBadge.jsx'
import usePrefersReducedMotion from '../hooks/usePrefersReducedMotion.js'

const SLIDE_MS = 8000 // mock "playback" length before auto-advance

// Screen 2 — immersive, swipeable, ranked reel feed.
export default function Feed({ clips, selected, focusIndex = 0, onOpen, onEdit }) {
  const reduced = usePrefersReducedMotion()
  const containerRef = useRef(null)
  const slideRefs = useRef([])
  const [active, setActive] = useState(focusIndex)
  const [playing, setPlaying] = useState(true)
  const [progress, setProgress] = useState(0)

  // jump to the clip we last viewed when coming back from the player
  useEffect(() => {
    slideRefs.current[focusIndex]?.scrollIntoView({ block: 'start' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // which slide is on screen
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

  const goTo = (i) =>
    slideRefs.current[i]?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })

  // mock playback progress on the active slide, then auto-advance
  useEffect(() => {
    setProgress(0)
    if (reduced || !playing) return
    let raf
    let start
    const tick = (t) => {
      if (start == null) start = t
      const p = Math.min((t - start) / SLIDE_MS, 1)
      setProgress(p)
      if (p < 1) raf = requestAnimationFrame(tick)
      else if (active < clips.length - 1) goTo(active + 1)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, playing, reduced, clips.length])

  if (clips.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
        <p className="text-[16px] leading-6 text-gray-900">
          No clips for these subjects yet. Edit your subjects to see more.
        </p>
        <button
          onClick={onEdit}
          className="h-10 rounded-sm bg-gray-1000 px-4 text-[14px] font-medium text-bg-100"
        >
          Edit Subjects
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
        <button
          onClick={onEdit}
          className="pointer-events-auto flex h-9 items-center gap-1.5 rounded-full bg-white/15 px-3 text-[13px] font-medium text-white backdrop-blur-sm transition-colors duration-150 ease-geist hover:bg-white/25"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Subjects
        </button>
      </div>

      {/* snap feed */}
      <div
        ref={containerRef}
        className="no-scrollbar h-full snap-y snap-mandatory overflow-y-scroll"
      >
        {clips.map((clip, i) => (
          <section
            key={clip.id}
            data-index={i}
            ref={(el) => (slideRefs.current[i] = el)}
            className="relative h-full w-full snap-start snap-always"
          >
            <ClipStage clip={clip}>
              {/* tap layer: toggle play */}
              <button
                aria-label={playing ? 'Pause' : 'Play'}
                onClick={() => setPlaying((p) => !p)}
                className="absolute inset-0 z-0"
              />

              {/* paused indicator */}
              {i === active && !playing && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center">
                  <div className="grid h-16 w-16 place-items-center rounded-full bg-black/35 text-white ring-1 ring-white/30 animate-pop">
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                </div>
              )}

              {/* action rail */}
              <div className="absolute bottom-32 right-3 z-10">
                <ActionRail clip={clip} />
              </div>

              {/* bottom meta */}
              <div
                className={`absolute inset-x-0 bottom-0 z-10 px-4 pb-7 pr-20 ${
                  i === active && !reduced ? 'animate-fade-up' : ''
                }`}
              >
                <div className="mb-2.5 flex flex-wrap items-center gap-2">
                  <SubjectTag accent={clip.accent}>{clip.subjectTag}</SubjectTag>
                  <RelevanceBadge score={clip.relevanceScore} />
                </div>
                <button
                  onClick={() => onOpen(i)}
                  className="block text-left text-[20px] font-semibold leading-7 tracking-[-0.4px] text-white"
                >
                  {clip.title}
                </button>
                <p className="mt-1 text-[14px] leading-5 text-white/80">@{clip.channel}</p>
                <p className="mt-1.5 line-clamp-2 text-[14px] leading-5 text-white/65">
                  {clip.description}
                </p>
                <button
                  onClick={() => onOpen(i)}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 text-[13px] font-medium text-white backdrop-blur-sm transition-colors duration-150 ease-geist hover:bg-white/25"
                >
                  Open clip
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                    <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>

              {/* playback progress */}
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

      {/* rank context */}
      <div className="pointer-events-none absolute bottom-3 left-4 z-20 font-mono text-[12px] text-white/55">
        {active + 1}/{clips.length} · ranked by relevance
      </div>
    </div>
  )
}
