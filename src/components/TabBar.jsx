// Bottom navigation — the 5-tab app shell from the design bundle
// (lr-screens.jsx `TABS`): Learn · For You · Watch · Progress · Map.
// Adapts to a dark glass bar over the immersive feed/player, light glass elsewhere.

function Search({ s = 22 }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
      <path d="M20 20l-3.2-3.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}
function Sparkles({ s = 22 }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <path d="M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8L12 3z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}
function Play({ s = 22, active }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill={active ? 'currentColor' : 'none'}>
      <path d="M8 5.5v13l11-6.5L8 5.5z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}
function Layers({ s = 22 }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <path d="M12 3l9 5-9 5-9-5 9-5z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M3 13l9 5 9-5" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}
function Target({ s = 22 }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="2" />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

const TABS = [
  ['learn', 'Learn', Search],
  ['foryou', 'For You', Sparkles],
  ['progress', 'Progress', Layers],
  ['map', 'Map', Target],
]
void Play // watch tab removed; icon kept for reference

export default function TabBar({ tab, onSelect, dark = false }) {
  return (
    <nav
      className={`relative z-50 flex shrink-0 items-stretch border-t pb-[max(8px,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur-xl ${
        dark ? 'border-white/10 bg-[#0c1020]/85' : 'border-gray-a-200 bg-bg-100/80'
      }`}
    >
      {TABS.map(([id, label, Icon]) => {
        const active = tab === id
        const color = dark
          ? active
            ? 'text-white'
            : 'text-white/45'
          : active
            ? 'text-accent-600'
            : 'text-gray-700'
        return (
          <button
            key={id}
            onClick={() => onSelect(id)}
            aria-current={active ? 'page' : undefined}
            aria-label={label}
            className={`flex flex-1 flex-col items-center gap-1 py-1 transition-colors duration-150 ease-geist ${color}`}
          >
            <Icon active={active} />
            <span className={`text-[10px] leading-none ${active ? 'font-semibold' : 'font-medium'}`}>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
