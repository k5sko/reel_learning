// Static class strings per accent so Tailwind keeps them in the build.
// (Dynamic `bg-${accent}-100` would get purged.)
export const TAG_CLASSES = {
  blue: 'bg-blue-100 text-blue-900 border-blue-400',
  green: 'bg-green-100 text-green-900 border-green-400',
  amber: 'bg-amber-100 text-amber-900 border-amber-400',
  purple: 'bg-purple-100 text-purple-900 border-purple-400',
}

export const DOT_CLASSES = {
  blue: 'bg-blue-700',
  green: 'bg-green-700',
  amber: 'bg-amber-700',
  purple: 'bg-purple-700',
}
