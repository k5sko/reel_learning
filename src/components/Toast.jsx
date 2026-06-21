import { useEffect } from 'react'

// Geist-style toast: names the specific thing that changed, no period, optional
// single action. Auto-dismisses; pinned open while it has an action to click.
export default function Toast({ toast, onDismiss }) {
  useEffect(() => {
    if (!toast) return
    const ms = toast.action ? 6000 : 3200
    const t = setTimeout(onDismiss, ms)
    return () => clearTimeout(t)
  }, [toast, onDismiss])

  if (!toast) return null

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-[360px] items-center gap-3 rounded-md border border-gray-a-200 bg-gray-1000 px-3.5 py-2.5 text-bg-100 shadow-modal animate-fade-up">
        {toast.tone === 'error' ? (
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-red-700 text-[12px] font-bold">!</span>
        ) : (
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0 text-green-400">
            <path d="M5 12l4 4 10-10" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
        <span className="text-[13px] leading-5">{toast.message}</span>
        {toast.action && (
          <button
            onClick={() => {
              toast.action.onClick()
              onDismiss()
            }}
            className="ml-1 shrink-0 rounded-sm bg-bg-100/15 px-2 py-1 text-[12px] font-medium text-bg-100 transition-colors duration-150 ease-geist hover:bg-bg-100/25"
          >
            {toast.action.label}
          </button>
        )}
      </div>
    </div>
  )
}
