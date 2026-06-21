// Immersive 9:16 stage for a clip. A clip is VIRTUAL: a [start, end] window over
// the job's source video. We seek the source to `start`, play, and stop/loop at
// `end` — no per-clip file. Progress is reported relative to the window.
// Playback is controlled by the parent via `playing` / `active`.

import { useEffect, useRef } from 'react'

const initials = (subjectTag) =>
  String(subjectTag || '')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase()

const angleFor = (id) => {
  let h = 0
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) % 360
  return 120 + (h % 90)
}

export default function ClipStage({
  clip,
  children,
  dim = false,
  playing = false,
  active = true,
  muted = false,
  onTime,
  onEnded,
}) {
  const [from, to] = clip.gradient
  const angle = angleFor(clip.id)
  const videoRef = useRef(null)
  const endedRef = useRef(false)

  const start = typeof clip.start === 'number' ? clip.start : 0
  const end = typeof clip.end === 'number' ? clip.end : start + (clip.durationSec || 0)
  const span = Math.max(0.1, end - start)

  // Seek to the window start when this clip becomes active (or changes).
  useEffect(() => {
    const v = videoRef.current
    if (!v || !active) return
    endedRef.current = false
    const seek = () => {
      try {
        v.currentTime = start
      } catch {
        /* not seekable yet */
      }
    }
    if (v.readyState >= 1) seek()
    else v.addEventListener('loadedmetadata', seek, { once: true })
  }, [active, clip.id, start])

  // Play/pause from the parent's intent (muted autoplay is always allowed).
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (active && playing) v.play().catch(() => {})
    else v.pause()
  }, [playing, active, clip.id])

  useEffect(() => {
    const v = videoRef.current
    if (v) v.muted = muted
  }, [muted])

  const handleTime = (e) => {
    const v = e.currentTarget
    if (v.currentTime < start - 0.25) {
      try {
        v.currentTime = start
      } catch {
        /* ignore */
      }
      return
    }
    if (v.currentTime >= end) {
      // Reached the window end: loop back to start; tell the parent (it may
      // advance to the next clip; the last clip just loops).
      try {
        v.currentTime = start
      } catch {
        /* ignore */
      }
      if (!endedRef.current) {
        endedRef.current = true
        if (onEnded) onEnded()
      }
      return
    }
    if (onTime) onTime(Math.min(1, Math.max(0, (v.currentTime - start) / span)))
  }

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* base gradient (also the letterbox behind the video) */}
      <div
        className="absolute inset-0"
        style={{ background: `linear-gradient(${angle}deg, ${from} 0%, ${to} 100%)` }}
      />
      <div
        className="absolute -left-1/4 -top-1/4 h-3/4 w-3/4 rounded-full opacity-50 blur-2xl"
        style={{ background: `radial-gradient(circle, ${from} 0%, transparent 70%)` }}
      />
      <div
        className="absolute -bottom-1/4 -right-1/4 h-3/4 w-3/4 rounded-full opacity-40 blur-2xl"
        style={{ background: `radial-gradient(circle, ${to} 0%, transparent 70%)` }}
      />

      {clip.videoUrl ? (
        <video
          ref={videoRef}
          src={clip.videoUrl}
          className="absolute inset-0 h-full w-full object-contain"
          playsInline
          preload="metadata"
          muted={muted}
          onTimeUpdate={handleTime}
        />
      ) : (
        <span
          className="pointer-events-none absolute -right-3 top-6 select-none font-mono font-medium leading-none text-white/15"
          style={{ fontSize: '128px' }}
        >
          {initials(clip.subjectTag)}
        </span>
      )}

      {/* legibility scrims */}
      <div className="absolute inset-x-0 top-0 h-1/4 bg-gradient-to-b from-black/30 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/55 to-transparent" />
      {dim && <div className="absolute inset-0 bg-black/30" />}

      {children}
    </div>
  )
}
