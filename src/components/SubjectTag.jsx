import { TAG_CLASSES, DOT_CLASSES } from './accent.js'

// Scannable label pill — pairs color with text + dot (never color alone).
export default function SubjectTag({ accent = 'blue', children, className = '' }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[12px] font-medium leading-4 ${TAG_CLASSES[accent]} ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${DOT_CLASSES[accent]}`} />
      {children}
    </span>
  )
}
