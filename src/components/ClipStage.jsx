// Immersive 9:16 background for a clip — shared by feed slides, the player,
// and (scaled down) card thumbnails. Renders the gradient placeholder until a
// real `thumbnailUrl` exists, plus a mesh highlight, grain, and subject monogram.

const initials = (subjectTag) =>
  subjectTag
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

// Deterministic per-clip variety so same-subject slides don't look identical.
const angleFor = (id) => {
  let h = 0
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360
  return 120 + (h % 90) // 120–210deg
}

export default function ClipStage({ clip, children, dim = false }) {
  const [from, to] = clip.gradient
  const angle = angleFor(clip.id)

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* base gradient */}
      <div
        className="absolute inset-0"
        style={{ background: `linear-gradient(${angle}deg, ${from} 0%, ${to} 100%)` }}
      />
      {/* mesh highlight blobs for depth */}
      <div
        className="absolute -left-1/4 -top-1/4 h-3/4 w-3/4 rounded-full opacity-50 blur-2xl"
        style={{ background: `radial-gradient(circle, ${from} 0%, transparent 70%)` }}
      />
      <div
        className="absolute -bottom-1/4 -right-1/4 h-3/4 w-3/4 rounded-full opacity-40 blur-2xl"
        style={{ background: `radial-gradient(circle, ${to} 0%, transparent 70%)` }}
      />

      {/* real frame, when one lands */}
      {clip.thumbnailUrl && (
        <img src={clip.thumbnailUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}

      {/* oversized subject monogram */}
      <span
        className="pointer-events-none absolute -right-3 top-6 select-none font-mono font-medium leading-none text-white/15"
        style={{ fontSize: '128px' }}
      >
        {initials(clip.subjectTag)}
      </span>

      {/* grain */}
      <div
        className="absolute inset-0 opacity-[0.10] mix-blend-overlay"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, #ffffff 1px, transparent 0)',
          backgroundSize: '13px 13px',
        }}
      />

      {/* legibility scrims */}
      <div className="absolute inset-x-0 top-0 h-1/4 bg-gradient-to-b from-black/30 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/55 to-transparent" />
      {dim && <div className="absolute inset-0 bg-black/30" />}

      {children}
    </div>
  )
}
