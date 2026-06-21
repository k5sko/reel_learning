// Immersive 9:16 stage for a clip. When the clip has a real `videoUrl` it plays
// the rendered .mp4 (object-contain) over a gradient letterbox; otherwise it
// shows the gradient placeholder + subject monogram. Playback is controlled by
// the parent via `playing` / `active`; progress + end are reported back.

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

  // Drive the element from the parent's play intent. Muted autoplay is always
  // allowed; an unmuted play() may be blocked until a user gesture (the tap
  // layer in the parent provides one).
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (active && playing) {
      v.play().catch(() => {})
    } else {
      v.pause()
      if (!active) {
        try {
          v.currentTime = 0
        } catch {
          /* ignore */
        }
      }
    }
  }, [playing, active, clip.id])

  useEffect(() => {
    const v = videoRef.current
    if (v) v.muted = muted
  }, [muted])

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* base gradient (also the letterbox behind 16:9 video) */}
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
          onTimeUpdate={(e) => {
            const v = e.currentTarget
            if (onTime && v.duration) onTime(v.currentTime / v.duration)
          }}
          onEnded={() => onEnded && onEnded()}
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
