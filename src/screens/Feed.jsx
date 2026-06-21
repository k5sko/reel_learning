import { useEffect, useRef, useState } from 'react'
import ClipStage from '../components/ClipStage.jsx'
import ActionRail from '../components/ActionRail.jsx'
import SubjectTag from '../components/SubjectTag.jsx'
import RelevanceBadge from '../components/RelevanceBadge.jsx'
import QuizCard from '../components/QuizCard.jsx'
import { makeQuiz, prereqQuiz } from '../api.js'
import usePrefersReducedMotion from '../hooks/usePrefersReducedMotion.js'

// Variable "every ~5 reels" cadence — a 4–7 reel gap so it's never on the dot.
const quizGap = () => 4 + Math.floor(Math.random() * 4)

// Screen 2 — immersive, swipeable reel feed playing the rendered clips.
export default function Feed({
  clips,
  focusIndex = 0,
  onEdit,
  onOpenGraph,
  onSaveLesson,
  onSaveError,
  onNeedMore,
  onWatched,
  onLike,
  onQuizResult, // (node, passed) -> recsys mastery / prereq discovery
  loadingMore = false, // next batch in flight -> cover the wait with quiz questions
  streaming = false, // recsys mode: append the next clip only when the user scrolls into the loader
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
  const engagedRef = useRef(new Set()) // clip ids the user liked/saved -> not discarded
  const handleLike = (clip) => {
    engagedRef.current.add(clip.id)
    onLike?.(clip)
  }
  const handleSave = (clip) => {
    engagedRef.current.add(clip.id)
    return onSaveLesson?.(clip)
  }

  // --- interstitial comprehension quiz ---
  const [quiz, setQuiz] = useState(null) // active quiz (array of MCQs) or null
  const watchedCountRef = useRef(0)
  const recentRef = useRef([]) // last few watched clips, most-recent first
  const nextQuizAtRef = useRef(quizGap()) // first check after 4–7 reels
  const quizBusyRef = useRef(false)
  const quizClipsRef = useRef([]) // clips this quiz was built from -> map question.clip_index to a node
  const loadingMoreRef = useRef(false)
  useEffect(() => {
    loadingMoreRef.current = loadingMore
  }, [loadingMore])

  // Fetch a quiz on the recently-watched clips and slide it up over the feed.
  // `cover` = the next batch is loading -> ask for more questions to fill the wait.
  const triggerQuiz = async (cover = false) => {
    quizBusyRef.current = true
    nextQuizAtRef.current = watchedCountRef.current + quizGap()
    const clipsForQuiz = recentRef.current.slice() // freeze order: clip_index maps into this
    if (!clipsForQuiz.length) {
      quizBusyRef.current = false
      return
    }
    quizClipsRef.current = clipsForQuiz
    try {
      const { questions } = await makeQuiz(clipsForQuiz.map((c) => c.id), cover ? 4 : 2)
      if (questions && questions.length) {
        setPlaying(false)
        setQuiz(questions)
      }
    } catch {
      /* no quiz this round — the feed just keeps playing */
    } finally {
      quizBusyRef.current = false
    }
  }

  const failedNodesRef = useRef([]) // nodes the learner got wrong this quiz -> diagnose their prereqs

  // Extend the quiz: (1) more cover questions while the batch loads, then (2) prereq-diagnostic
  // questions for any node the learner failed. [] -> quiz closes.
  const fetchMoreQuiz = async () => {
    if (loadingMoreRef.current) {
      try {
        const { questions } = await makeQuiz(quizClipsRef.current.map((c) => c.id), 8)
        if (questions && questions.length) return questions
      } catch {
        /* fall through */
      }
    }
    while (failedNodesRef.current.length) {
      const node = failedNodesRef.current.shift()
      try {
        const { questions } = await prereqQuiz(node) // each Q tagged with its prereq node id
        if (questions && questions.length) return questions
      } catch {
        /* try the next failed node */
      }
    }
    return []
  }

  // Cover quiz: generated IN PARALLEL with the batch fetch (see prefetch trigger below) so it's
  // ready the instant the user reaches the end — no separate wait for quiz generation.
  const pendingQuizRef = useRef(null) // pre-made cover quiz, shown when the user is stuck loading
  const atEndRef = useRef(false)

  const prepCoverQuiz = () => {
    if (quizBusyRef.current || pendingQuizRef.current || !recentRef.current.length) return
    quizBusyRef.current = true
    const clipsForQuiz = recentRef.current.slice()
    quizClipsRef.current = clipsForQuiz
    makeQuiz(clipsForQuiz.map((c) => c.id), 8)
      .then(({ questions }) => {
        pendingQuizRef.current = questions && questions.length ? questions : null
      })
      .catch(() => {
        pendingQuizRef.current = null
      })
      .finally(() => {
        quizBusyRef.current = false
        maybeShowCover()
      })
  }

  // Show the pre-made 8-question quiz once the user scrolls past the last clip of the batch
  // (whether or not the next batch is still loading — it doubles as the end-of-batch checkpoint).
  const maybeShowCover = () => {
    if (atEndRef.current && !quiz && pendingQuizRef.current) {
      setPlaying(false)
      setQuiz(pendingQuizRef.current)
      pendingQuizRef.current = null
    }
  }

  // re-check when loading flips (batch started while the user is already at the end)
  useEffect(() => {
    maybeShowCover()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingMore])

  // Each answer -> mastery signal for the node it tested.
  const onQuizAnswer = (q, isCorrect) => {
    if (q?.node) {
      // prereq-diagnostic question (tagged with its prereq node) -> record, DON'T diagnose deeper
      onQuizResult?.(q.node, isCorrect, true)
      return
    }
    // cover/regular question -> the clip's node (via clip_index)
    const clip = quizClipsRef.current[q?.clip_index ?? 0] || quizClipsRef.current[0]
    if (clip?.recNode) {
      onQuizResult?.(clip.recNode, isCorrect, false)
      if (!isCorrect && !failedNodesRef.current.includes(clip.recNode)) {
        failedNodesRef.current.push(clip.recNode) // -> prereq diagnostic when the quiz extends
      }
    }
  }

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
    if (prev !== active && clips[prev]) {
      const watched = clips[prev]
      // engaged flag: liked/saved -> not a discard (recsys style signal)
      onWatched?.(watched, lastProgressRef.current, engagedRef.current.has(watched.id))
      // keep the recent batch for the end-of-batch quiz (8 Qs on what was just covered)
      recentRef.current = [watched, ...recentRef.current.filter((c) => c.id !== watched.id)].slice(0, 8)
    }
    prevActiveRef.current = active
    lastProgressRef.current = 0
    atEndRef.current = active >= clips.length // scrolled into the trailing loader = past last clip
    // Prefetch the next batch ~2 clips before the end AND generate the cover quiz in PARALLEL, so by
    // the time the user reaches the end the quiz is already made (covers the fetch with no extra wait).
    if (streaming && active >= clips.length - 2) {
      onNeedMore?.()
      prepCoverQuiz()
    }
    maybeShowCover()
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
              onEnded={() => {}}
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
                <ActionRail clip={clip} onLike={handleLike} onSaveLesson={handleSave} onSaveError={onSaveError} />
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

        {/* trailing loader slide: scrolling INTO this is what fetches the next clip (strict 1-at-a-time) */}
        {streaming && (
          <section
            data-index={clips.length}
            ref={(el) => (slideRefs.current[clips.length] = el)}
            className="h-full w-full snap-start snap-always animate-pulse bg-gradient-to-b from-[#1c1f27] to-[#0e0f14]"
          />
        )}
      </div>

      {quiz && (
        <QuizCard
          quiz={quiz}
          onAnswer={onQuizAnswer}
          onMore={fetchMoreQuiz}
          onClose={() => {
            setQuiz(null)
            setPlaying(true)
          }}
        />
      )}

          </div>
  )
}
