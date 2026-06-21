import { useEffect, useMemo, useRef, useState } from 'react'
import { getGraph, resetGraph } from '../lib/memoryApi.js'
import useForceGraph from '../hooks/useForceGraph.js'
import usePrefersReducedMotion from '../hooks/usePrefersReducedMotion.js'
import SubjectTag from '../components/SubjectTag.jsx'

const VBW = 380
const VBH = 300

// Subject accent -> graph colors (Geist scales from design.md).
const ACCENT = {
  blue: { ring: '#006bff', fill: '#dfefff', text: '#005ff2' },
  green: { ring: '#28a948', fill: '#d3fad1', text: '#107d32' },
  amber: { ring: '#ffae00', fill: '#fff1c1', text: '#aa4d00' },
  purple: { ring: '#a000f8', fill: '#f6e8ff', text: '#7d00cc' },
  pink: { ring: '#f22782', fill: '#ffe8f6', text: '#c41562' },
  teal: { ring: '#00ac96', fill: '#defffb', text: '#007f70' },
}
const accentOf = (a) => ACCENT[a] || ACCENT.blue
const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

// White outline behind label text so edge lines never cut through it.
const HALO = { paintOrder: 'stroke', stroke: '#fafafa', strokeWidth: 3, strokeLinejoin: 'round' }

// Obsidian-style memory workspace: an interactive mappings graph on top, your
// Library of saved lessons below. Selecting in one focuses the other.
export default function MemoryGraph({ onClose, refreshKey = 0, highlightIds = [] }) {
  const reduced = usePrefersReducedMotion()
  const [graph, setGraph] = useState({ nodes: [], edges: [], lessons: [], meta: {} })
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [error, setError] = useState('')
  const [selectedNodeId, setSelectedNodeId] = useState(null)
  const [focusLessonId, setFocusLessonId] = useState(null)
  const [categorySubject, setCategorySubject] = useState(null)
  const svgRef = useRef(null)
  const dragId = useRef(null)

  const load = async () => {
    setStatus('loading')
    try {
      const g = await getGraph()
      setGraph(g)
      setStatus('ready')
    } catch (e) {
      setError(e.message)
      setStatus('error')
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  const { nodes, edges, lessons } = graph
  const highlight = useMemo(() => new Set(highlightIds), [highlightIds])

  const nodeById = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
  // Distinct subjects present -> the color categories shown up top.
  const categories = useMemo(() => {
    const seen = new Map()
    for (const n of nodes) if (!seen.has(n.subject)) seen.set(n.subject, n.accent)
    return [...seen.entries()].map(([subject, accent]) => ({ subject, accent }))
  }, [nodes])

  // adjacency for neighbor lookups
  const adj = useMemo(() => {
    const m = new Map()
    const add = (a, b) => m.set(a, (m.get(a) || new Set()).add(b))
    for (const e of edges) {
      add(e.from, e.to)
      add(e.to, e.from)
    }
    return m
  }, [edges])

  // Focus set: the subset to spread out — a selected category (its nodes + their
  // neighbors) or a selected lesson (its points + their neighbors).
  const focusSet = useMemo(() => {
    if (categorySubject) {
      const s = new Set()
      for (const n of nodes) if (n.subject === categorySubject) s.add(n.id)
      for (const id of [...s]) for (const nb of adj.get(id) || []) s.add(nb)
      return s
    }
    if (focusLessonId) {
      const l = lessons.find((x) => x.id === focusLessonId)
      if (!l) return null
      const s = new Set(l.pointIds)
      for (const pid of l.pointIds) for (const nb of adj.get(pid) || []) s.add(nb)
      return s
    }
    return null
  }, [categorySubject, focusLessonId, nodes, lessons, adj])
  const isFocusMode = !!focusSet

  // Two independent physics layouts: the full graph, and (when focused) one over
  // just the subset so it spreads across the whole plane and stays draggable.
  // Switching back to the base layout restores the original graph untouched.
  const focusNodes = useMemo(
    () => (isFocusMode ? nodes.filter((n) => focusSet.has(n.id)) : []),
    [isFocusMode, nodes, focusSet],
  )
  const focusEdges = useMemo(
    () => (isFocusMode ? edges.filter((e) => focusSet.has(e.from) && focusSet.has(e.to)) : []),
    [isFocusMode, edges, focusSet],
  )
  const baseLayout = useForceGraph(nodes, edges, { width: VBW, height: VBH, reduced })
  const focusLayout = useForceGraph(focusNodes, focusEdges, { width: VBW, height: VBH, reduced })
  const layout = isFocusMode ? focusLayout : baseLayout

  // In normal mode, a clicked node highlights itself + its neighbors in place.
  const selectionSet = useMemo(() => {
    if (isFocusMode || !selectedNodeId) return null
    const s = new Set([selectedNodeId])
    for (const n of adj.get(selectedNodeId) || []) s.add(n)
    return s
  }, [isFocusMode, selectedNodeId, adj])

  const selectedNode = nodes.find((n) => n.id === selectedNodeId) || null
  const selectedDegree = selectedNode ? (adj.get(selectedNode.id)?.size ?? 0) : 0

  // selection helpers --------------------------------------------------------
  const selectNode = (id) => setSelectedNodeId(id)
  const selectLesson = (l) => {
    setSelectedNodeId(null)
    setCategorySubject(null)
    setFocusLessonId(l.id)
  }
  const toggleCategory = (subject) => {
    setSelectedNodeId(null)
    setFocusLessonId(null)
    setCategorySubject((c) => (c === subject ? null : subject))
  }
  const clearFocus = () => {
    setSelectedNodeId(null)
    setFocusLessonId(null)
    setCategorySubject(null)
  }

  // drag ---------------------------------------------------------------------
  const toSvg = (clientX, clientY) => {
    const rect = svgRef.current.getBoundingClientRect()
    return {
      x: ((clientX - rect.left) / rect.width) * VBW,
      y: ((clientY - rect.top) / rect.height) * VBH,
    }
  }
  // Drag works in both modes (each layout supports it). Moved past a small
  // threshold => treat as a drag, so a real drag doesn't also fire a select.
  const moved = useRef(false)
  const onNodeDown = (e, id) => {
    e.stopPropagation()
    dragId.current = id
    moved.current = false
    layout.pin(id)
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onMove = (e) => {
    if (!dragId.current) return
    moved.current = true
    const { x, y } = toSvg(e.clientX, e.clientY)
    layout.setPos(dragId.current, x, y)
  }
  const onUp = () => {
    if (dragId.current) {
      layout.unpin(dragId.current)
      dragId.current = null
    }
  }

  const onReset = async () => {
    try {
      const g = await resetGraph()
      clearFocus()
      setGraph(g)
      baseLayout.reheat()
    } catch (e) {
      setError(e.message)
      setStatus('error')
    }
  }

  // Highlight/dim helpers. In focus mode everything shown is lit; in normal mode
  // a node selection lights itself + neighbors.
  const isVisible = (id) => !isFocusMode || focusSet.has(id)
  const edgeShown = (e) => (isFocusMode ? focusSet.has(e.from) && focusSet.has(e.to) : true)
  const edgeLit = (e) =>
    isFocusMode ? true : !!selectionSet && selectionSet.has(e.from) && selectionSet.has(e.to)

  return (
    <div className="flex h-full flex-col bg-bg-100">
      {/* header */}
      <header className="z-20 flex items-center justify-between border-b border-gray-a-200 px-4 py-3">
        <button
          onClick={onClose}
          aria-label="Back"
          className="grid h-9 w-9 place-items-center rounded-full text-gray-1000 transition-colors duration-150 ease-geist hover:bg-gray-a-100"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="text-center">
          <h1 className="text-[16px] font-semibold leading-5 tracking-[-0.32px] text-gray-1000">Memory</h1>
          <p className="font-mono text-[12px] leading-4 text-gray-700">
            {graph.meta.lessonCount ?? lessons.length} lessons · {graph.meta.nodeCount ?? nodes.length} points ·{' '}
            {graph.meta.redis ? 'redis' : 'mock'}
          </p>
        </div>
        <button
          onClick={onReset}
          aria-label="Reset graph"
          className="grid h-9 w-9 place-items-center rounded-full text-gray-700 transition-colors duration-150 ease-geist hover:bg-gray-a-100 hover:text-gray-1000"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M4 12a8 8 0 1 1 2.3 5.6M4 18v-4h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      {/* ── category color key (tap to isolate a subject) ──────── */}
      {categories.length > 0 && (
        <div className="no-scrollbar flex shrink-0 items-center gap-2 overflow-x-auto border-b border-gray-a-100 px-4 py-2">
          {categories.map(({ subject, accent }) => {
            const active = categorySubject === subject
            return (
              <button
                key={subject}
                onClick={() => toggleCategory(subject)}
                aria-pressed={active}
                className={`shrink-0 rounded-full transition-all duration-150 ease-geist ${
                  categorySubject && !active ? 'opacity-35' : 'opacity-100'
                } ${active ? 'ring-2 ring-gray-1000 ring-offset-1' : ''}`}
              >
                <SubjectTag accent={accent}>{subject}</SubjectTag>
              </button>
            )
          })}
        </div>
      )}

      {/* ── graph pane ─────────────────────────────────────────── */}
      <div className="relative shrink-0 basis-[42%] overflow-hidden border-b border-gray-a-200 bg-bg-200">
        {status === 'error' && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 px-8 text-center">
            <p className="text-[13px] leading-5 text-red-900">Couldn’t load. {error}</p>
            <button onClick={load} className="h-9 rounded-sm bg-gray-1000 px-3 text-[13px] font-medium text-bg-100">
              Try Again
            </button>
          </div>
        )}

        <svg
          ref={svgRef}
          viewBox={`0 0 ${VBW} ${VBH}`}
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full touch-none select-none"
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
          onClick={() => setSelectedNodeId(null)}
        >
          {edges.map((e) => {
            if (!edgeShown(e)) return null
            const a = layout.positions.get(e.from)
            const b = layout.positions.get(e.to)
            if (!a || !b) return null
            const lit = edgeLit(e)
            const dim = !isFocusMode && selectionSet && !lit
            const mx = (a.x + b.x) / 2
            const my = (a.y + b.y) / 2
            return (
              <g key={e.id} opacity={dim ? 0.1 : 1}>
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={lit ? '#525252' : '#d6d6d6'}
                  strokeWidth={lit ? (e.relation === 'part of' ? 1.6 : 2.4) : e.relation === 'part of' ? 1 : 1.5}
                  strokeDasharray={e.relation === 'part of' ? '3 3' : 'none'}
                />
                {lit && (
                  <text
                    x={mx}
                    y={my - 4}
                    textAnchor="middle"
                    className="fill-gray-1000 font-mono font-medium"
                    fontSize="8.5"
                    style={HALO}
                  >
                    {e.relation}
                  </text>
                )}
              </g>
            )
          })}

          {nodes.map((n) => {
            if (!isVisible(n.id)) return null
            const p = layout.positions.get(n.id)
            if (!p) return null
            const c = accentOf(n.accent)
            const isPlan = n.type === 'lesson_plan'
            const isSelected = n.id === selectedNodeId
            const inSelection = !!selectionSet && selectionSet.has(n.id)
            const emphasized = isFocusMode || inSelection
            const dim = !isFocusMode && selectionSet && !inSelection
            const isNew = highlight.has(n.id)
            const r = (isPlan ? 13 : 8) + (isSelected ? 4 : emphasized ? 2 : 0)
            const showLabel = isFocusMode || isPlan || isNew || inSelection
            return (
              <g
                key={n.id}
                transform={`translate(${p.x} ${p.y})`}
                opacity={dim ? 0.14 : 1}
                className="cursor-pointer"
                onPointerDown={(e) => onNodeDown(e, n.id)}
                onClick={(e) => {
                  e.stopPropagation()
                  if (!moved.current) selectNode(n.id)
                }}
              >
                {isNew && <circle r={r + 6} fill={c.ring} opacity="0.25" className="animate-pulse-ring" />}
                {isSelected && <circle r={r + 6} fill="none" stroke={c.ring} strokeWidth="2" opacity="0.55" />}
                <circle r={r} fill={c.fill} stroke={c.ring} strokeWidth={isPlan ? 2.5 : 2} />
                {isPlan && <circle r={r - 5} fill={c.ring} opacity="0.9" />}
                {showLabel && (
                  <text
                    y={r + 11}
                    textAnchor="middle"
                    fontSize={isPlan ? 10 : 9}
                    className={isPlan || emphasized ? 'fill-gray-1000 font-semibold' : 'fill-gray-900'}
                    style={HALO}
                  >
                    {truncate(n.title, isPlan ? 18 : 16)}
                  </text>
                )}
              </g>
            )
          })}
        </svg>

        {/* legend */}
        <div className="pointer-events-none absolute left-3 top-3 flex gap-3 rounded-md bg-bg-100/80 px-2.5 py-1.5 text-[11px] text-gray-900 backdrop-blur-sm">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full border-2 border-gray-700 bg-gray-300" /> Lesson
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full border-2 border-gray-600" /> Point
          </span>
        </div>

        {/* node detail overlay */}
        {selectedNode && (
          <div className="absolute inset-x-3 bottom-3 rounded-md border border-gray-a-200 bg-bg-100 px-3 py-2.5 shadow-popover animate-fade-up">
            <div className="mb-1 flex items-center gap-2">
              <SubjectTag accent={selectedNode.accent}>{selectedNode.subject}</SubjectTag>
              <span className="font-mono text-[10px] uppercase tracking-wide text-gray-700">
                {selectedNode.type === 'lesson_plan' ? 'Lesson' : 'Memory point'} · {selectedDegree} links
              </span>
            </div>
            <p className="text-[14px] font-semibold leading-5 tracking-[-0.2px] text-gray-1000">
              {selectedNode.title}
            </p>
            <p className="mt-0.5 line-clamp-2 text-[12px] leading-4 text-gray-900">{selectedNode.summary}</p>
          </div>
        )}
      </div>

      {/* ── library pane ───────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-gray-a-100 px-4 py-2">
          <h2 className="text-[13px] font-semibold tracking-[-0.2px] text-gray-1000">Saved Lessons</h2>
          {focusLessonId ? (
            <button onClick={clearFocus} className="text-[12px] font-medium text-blue-700 hover:underline">
              Show all
            </button>
          ) : (
            <span className="font-mono text-[12px] text-gray-700">{lessons.length}</span>
          )}
        </div>

        <div className="no-scrollbar flex-1 overflow-y-auto px-3 py-2">
          {status !== 'error' && lessons.length === 0 && (
            <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
              <p className="text-[14px] font-medium text-gray-1000">No saved lessons yet</p>
              <p className="text-[12px] leading-4 text-gray-700">Save a lesson from a clip to start your Library.</p>
            </div>
          )}

          <ul className="flex flex-col gap-2">
            {lessons.map((l) => {
              const focused = l.id === focusLessonId
              const isNew = (l.pointIds || []).some((id) => highlight.has(id))
              const c = accentOf(l.accent)
              return (
                <li key={l.id}>
                  <button
                    onClick={() => (focused ? clearFocus() : selectLesson(l))}
                    className={`w-full rounded-md border px-3 py-2.5 text-left transition-colors duration-150 ease-geist ${
                      focused
                        ? 'border-gray-a-400 bg-bg-200'
                        : 'border-gray-a-200 bg-bg-100 hover:bg-bg-200'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.ring }} />
                      <span className="flex-1 truncate text-[14px] font-semibold tracking-[-0.2px] text-gray-1000">
                        {l.title}
                      </span>
                      {isNew && (
                        <span className="shrink-0 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">
                          New
                        </span>
                      )}
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <SubjectTag accent={l.accent}>{l.subject}</SubjectTag>
                      <span className="font-mono text-[11px] text-gray-700">
                        {(l.pointIds || []).length} point{(l.pointIds || []).length === 1 ? '' : 's'}
                      </span>
                    </div>

                    {/* memory-point chips — click to jump to that node in the graph */}
                    {focused && (
                      <div className="mt-2 flex flex-wrap gap-1.5 animate-fade-up">
                        {(l.pointIds || []).map((pid) => {
                          const node = nodeById.get(pid)
                          if (!node) return null
                          return (
                            <span
                              key={pid}
                              role="button"
                              tabIndex={0}
                              onClick={(e) => {
                                e.stopPropagation()
                                selectNode(pid)
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.stopPropagation()
                                  selectNode(pid)
                                }
                              }}
                              className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors duration-150 ease-geist ${
                                selectedNodeId === pid
                                  ? 'border-gray-1000 bg-gray-1000 text-bg-100'
                                  : 'border-gray-a-300 bg-bg-100 text-gray-1000 hover:bg-gray-a-100'
                              }`}
                            >
                              {truncate(node.title, 22)}
                            </span>
                          )
                        })}
                      </div>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>
  )
}
