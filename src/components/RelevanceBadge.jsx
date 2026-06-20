// Placeholder "relevance" signal — stands in for the future ranking model.
// Pairs the icon + text so meaning never rests on color alone.
export default function RelevanceBadge({ score, className = '' }) {
  const pct = Math.round(score * 100)
  return (
    <span
      title="Placeholder relevance — ranking model not built yet"
      className={`inline-flex items-center gap-1 rounded-full border border-blue-400 bg-blue-100 px-2 py-0.5 font-mono text-[12px] font-medium leading-4 text-blue-900 ${className}`}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z"
          fill="currentColor"
        />
      </svg>
      {pct}% match
    </span>
  )
}
