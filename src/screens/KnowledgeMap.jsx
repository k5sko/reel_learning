import { useEffect, useMemo, useRef, useState } from 'react'
import { recsysGraph } from '../api.js'
import useForceGraph from '../hooks/useForceGraph.js'
import usePrefersReducedMotion from '../hooks/usePrefersReducedMotion.js'

// Obsidian-style map of everything the user has queried: goal nodes (queries) + their
// prerequisite DAG. Click a goal to focus its prereq subtree (what to study before it).

const VBW = 380
const VBH = 470

// node color by role/state
const COL = {
  goal: { ring: '#006bff', fill: '#13233f' },
  mastered: { ring: '#28a948', fill: '#123018' },
  frontier: { ring: '#ffae00', fill: '#3a2e12' }, // ready to learn now
  locked: { ring: '#565b69', fill: '#191b22' }, // prereqs not yet met
}
const truncate = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '')
const HALO = { paintOrder: 'stroke', stroke: '#0a0b10', strokeWidth: 3, strokeLinejoin: 'round' }

export default function KnowledgeMap({ onClose, refreshKey = 0 }) {
  const reduced = usePrefersReducedMotion()
  const [g, setG] = useState({ nodes: [], edges: [], goals: [], frontier: [] })
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [focusGoal, setFocusGoal] = useState(null)
  const [sel, setSel] = useState(null)
  const svgRef = useRef(null)
  const dragId = useRef(null)
  const moved = useRef(false)

  const load = async () => {
    setStatus('loading')
    try {
      setG(await recsysGraph())
      setStatus('ready')
    } catch (e) {
      setError(String(e.message || e))
      setStatus('error')
    }
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])

  const { nodes, edges } = g
  const goalSet = useMemo(() => new Set(g.goals || []), [g.goals])
  const frontierSet = useMemo(() => new Set(g.frontier || []), [g.frontier])

  // node -> its prerequisites (edges are prereq->node, so reverse-index by `to`)
  const prereqsOf = useMemo(() => {
    const m = new Map()
    for (const e of edges) {
      if (!m.has(e.to)) m.set(e.to, new Set())
      m.get(e.to).add(e.from)
    }
    return m
  }, [edges])

  // focus = a goal + the transitive closure of its prerequisites (the study subtree)
  const focusSet = useMemo(() => {
    if (!focusGoal) return null
    const s = new Set([focusGoal])
    const stack = [focusGoal]
    while (stack.length) {
      for (const p of prereqsOf.get(stack.pop()) || []) {
        if (!s.has(p)) {
          s.add(p)
          stack.push(p)
        }
      }
    }
    return s
  }, [focusGoal, prereqsOf])

  const layout = useForceGraph(nodes, edges, {
    width: VBW,
    height: VBH,
    reduced,
    repulsion: 6500,
    minSep: 58,
    edgeLength: 92,
  })

  const colorOf = (n) =>
    n.is_goal ? COL.goal : n.mastered ? COL.mastered : frontierSet.has(n.id) ? COL.frontier : COL.locked
  const visible = (id) => !focusSet || focusSet.has(id)
  const selNode = nodes.find((n) => n.id === sel) || null

  // drag (same pattern as the memory graph)
  const toSvg = (cx, cy) => {
    const r = svgRef.current.getBoundingClientRect()
    return { x: ((cx - r.left) / r.width) * VBW, y: ((cy - r.top) / r.height) * VBH }
  }
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

  const nodeClick = (n) => {
    if (moved.current) return
    setSel(n.id)
    if (n.is_goal) setFocusGoal((cur) => (cur === n.id ? null : n.id)) // toggle focus on goals
  }

  return (
    <div className="flex h-full flex-col bg-bg-100">
      <header className="z-20 flex items-center justify-between border-b border-gray-a-200 px-4 py-3">
        <button
          onClick={onClose}
          aria-label="Back"
          className="grid h-9 w-9 place-items-center rounded-full text-gray-1000 hover:bg-gray-a-100"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="text-center">
          <h1 className="text-[16px] font-semibold leading-5 tracking-[-0.32px] text-gray-1000">Knowledge Map</h1>
          <p className="font-mono text-[12px] leading-4 text-gray-700">
            {goalSet.size} quer{goalSet.size === 1 ? 'y' : 'ies'} · {nodes.length} concepts
          </p>
        </div>
        <button
          onClick={load}
          aria-label="Refresh"
          className="grid h-9 w-9 place-items-center rounded-full text-gray-700 hover:bg-gray-a-100 hover:text-gray-1000"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M4 12a8 8 0 1 1 2.3 5.6M4 18v-4h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-bg-200">
        {status === 'error' && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 px-8 text-center">
            <p className="text-[13px] leading-5 text-red-900">Couldn’t load. {error}</p>
            <button onClick={load} className="h-9 rounded-sm bg-gray-1000 px-3 text-[13px] font-medium text-bg-100">
              Try Again
            </button>
          </div>
        )}
        {status === 'ready' && nodes.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-8 text-center">
            <p className="text-[14px] font-medium text-gray-1000">No queries yet</p>
            <p className="text-[12px] leading-4 text-gray-700">Build a feed for a topic — it appears here with its prerequisites.</p>
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
          onClick={() => {
            setSel(null)
            setFocusGoal(null)
          }}
        >
          {edges.map((e, i) => {
            if (focusSet && !(focusSet.has(e.from) && focusSet.has(e.to))) return null
            const a = layout.positions.get(e.from)
            const b = layout.positions.get(e.to)
            if (!a || !b) return null
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={focusSet ? '#c9cbd6' : '#2b2d36'}
                strokeWidth={1.6}
              />
            )
          })}

          {nodes.map((n) => {
            if (!visible(n.id)) return null
            const p = layout.positions.get(n.id)
            if (!p) return null
            const c = colorOf(n)
            const isSel = n.id === sel
            const r = (n.is_goal ? 12 : 8) + (isSel ? 4 : 0)
            const showLabel = n.is_goal || !!focusSet || isSel
            return (
              <g
                key={n.id}
                transform={`translate(${p.x} ${p.y})`}
                className="cursor-pointer"
                onPointerDown={(e) => onNodeDown(e, n.id)}
                onClick={(e) => {
                  e.stopPropagation()
                  nodeClick(n)
                }}
              >
                {isSel && <circle r={r + 6} fill="none" stroke={c.ring} strokeWidth="2" opacity="0.55" />}
                <circle r={r} fill={c.fill} stroke={c.ring} strokeWidth={n.is_goal ? 2.5 : 2} />
                {showLabel && (
                  <text
                    y={r + 11}
                    textAnchor="middle"
                    fontSize={n.is_goal ? 10 : 9}
                    className={n.is_goal ? 'fill-gray-1000 font-semibold' : 'fill-gray-900'}
                    style={HALO}
                  >
                    {truncate(n.label, n.is_goal ? 20 : 16)}
                  </text>
                )}
              </g>
            )
          })}
        </svg>

        {/* legend */}
        <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1 rounded-md bg-bg-100/80 px-2.5 py-1.5 text-[11px] text-gray-900 backdrop-blur-sm">
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: COL.goal.ring }} /> Query</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: COL.frontier.ring }} /> Ready</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: COL.mastered.ring }} /> Mastered</span>
          <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: COL.locked.ring }} /> Locked</span>
        </div>

        {focusGoal && (
          <button
            onClick={() => {
              setFocusGoal(null)
              setSel(null)
            }}
            className="absolute right-3 top-3 rounded-full bg-gray-1000 px-3 py-1.5 text-[12px] font-medium text-bg-100"
          >
            Show all
          </button>
        )}

        {selNode && (
          <div className="absolute inset-x-3 bottom-3 rounded-md border border-gray-a-200 bg-bg-100 px-3 py-2.5 shadow-popover animate-fade-up">
            <div className="mb-1 flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wide text-gray-700">
                {selNode.is_goal ? 'Query' : selNode.mastered ? 'Mastered' : frontierSet.has(selNode.id) ? 'Ready to learn' : 'Locked'}
                {' · '}mastery {Math.round((selNode.mastery || 0) * 100)}%
                {' · '}{(prereqsOf.get(selNode.id)?.size ?? 0)} prereq{(prereqsOf.get(selNode.id)?.size ?? 0) === 1 ? '' : 's'}
              </span>
            </div>
            <p className="text-[14px] font-semibold leading-5 tracking-[-0.2px] text-gray-1000">{selNode.label}</p>
            {selNode.is_goal && (
              <p className="mt-0.5 text-[12px] leading-4 text-gray-700">Tap again to {focusGoal === selNode.id ? 'exit' : 'focus'} its prerequisites.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
