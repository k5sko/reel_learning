import { useEffect, useMemo, useRef, useState } from 'react'
import { recsysGraph } from '../api.js'
import useForceGraph from '../hooks/useForceGraph.js'
import usePrefersReducedMotion from '../hooks/usePrefersReducedMotion.js'

// Obsidian-style knowledge map.
//  - Overview: a node per requested TOPIC, linked by conceptual relation (force graph).
//  - Drill-in: tap a topic -> its prerequisite skill tree (lazily-discovered), laid out top-down.

const VBW = 380
const VBH = 520

// node colors by state
const COL = {
  goal: { ring: '#8ab4ff', fill: '#1a2747', glow: '#3b5bbf' },
  mastered: { ring: '#5fd472', fill: '#14301c', glow: '#2ea043' },
  ready: { ring: '#e7c14e', fill: '#332a12', glow: '#b8860b' },
  locked: { ring: '#5b6270', fill: '#161922', glow: '#2b3140' },
}
const colorOf = (n) =>
  n.is_goal ? COL.goal : n.mastered ? COL.mastered : n.ready ? COL.ready : COL.locked
const truncate = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '')
const HALO = { paintOrder: 'stroke', stroke: '#0b0d12', strokeWidth: 3.5, strokeLinejoin: 'round' }

export default function KnowledgeMap({ onClose, refreshKey = 0 }) {
  const reduced = usePrefersReducedMotion()
  const [g, setG] = useState({ goals: [], relations: [], nodes: [], edges: [], frontier: [] })
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [focusGoal, setFocusGoal] = useState(null)
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

  const nodeById = useMemo(() => new Map(g.nodes.map((n) => [n.id, n])), [g.nodes])
  const prereqsOf = useMemo(() => {
    const m = new Map()
    for (const e of g.edges) {
      if (!m.has(e.to)) m.set(e.to, [])
      m.get(e.to).push(e.from)
    }
    return m
  }, [g.edges])

  // ---------- DRILL: goal + transitive prereqs, top-down skill-tree layout ----------
  const tree = useMemo(() => {
    if (!focusGoal) return null
    const depth = new Map([[focusGoal, 0]])
    const order = [focusGoal]
    const q = [focusGoal]
    while (q.length) {
      const cur = q.shift()
      for (const p of prereqsOf.get(cur) || []) {
        if (!depth.has(p)) {
          depth.set(p, depth.get(cur) + 1)
          order.push(p)
          q.push(p)
        }
      }
    }
    const byDepth = {}
    for (const id of order) (byDepth[depth.get(id)] ||= []).push(id)
    const maxD = Math.max(0, ...depth.values())
    const padY = 64
    const rowH = (VBH - 2 * padY) / Math.max(1, maxD)
    const pos = new Map()
    for (const d of Object.keys(byDepth)) {
      const row = byDepth[d]
      row.forEach((id, i) => pos.set(id, { x: (VBW * (i + 1)) / (row.length + 1), y: padY + d * rowH }))
    }
    const edges = []
    for (const id of order) for (const p of prereqsOf.get(id) || []) if (depth.has(p)) edges.push([p, id])
    return { ids: order, pos, edges }
  }, [focusGoal, prereqsOf])

  // ---------- OVERVIEW: topics + conceptual relations (force) ----------
  const overviewEdges = useMemo(
    () => g.relations.map((r, i) => ({ id: 'r' + i, from: r.from, to: r.to })),
    [g.relations],
  )
  const layout = useForceGraph(g.goals, overviewEdges, {
    width: VBW,
    height: VBH,
    reduced,
    repulsion: 9500,
    minSep: 82,
    edgeLength: 140,
    gravity: 0.016,
  })

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

  const Node = ({ n, x, y, r, onClick }) => {
    const c = colorOf(n)
    return (
      <g transform={`translate(${x} ${y})`} className="cursor-pointer" onClick={onClick}>
        <circle r={r + 7} fill={c.glow} opacity="0.18" />
        <circle r={r} fill={c.fill} stroke={c.ring} strokeWidth="2" />
        <text
          y={r + 13}
          textAnchor="middle"
          fontSize={n.is_goal ? 11 : 9.5}
          className={n.is_goal ? 'fill-white font-semibold' : 'fill-white/80'}
          style={HALO}
        >
          {truncate(n.label, n.is_goal ? 22 : 18)}
        </text>
      </g>
    )
  }

  const focusNode = focusGoal ? nodeById.get(focusGoal) : null

  return (
    <div className="flex h-full flex-col bg-[#0b0d12]">
      <header className="z-20 flex items-center justify-between border-b border-white/10 px-4 py-3">
        <button
          onClick={focusGoal ? () => setFocusGoal(null) : onClose}
          aria-label="Back"
          className="grid h-9 w-9 place-items-center rounded-full text-white/80 hover:bg-white/10"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="text-center">
          <h1 className="text-[16px] font-semibold leading-5 tracking-[-0.32px] text-white">
            {focusGoal ? truncate(focusNode?.label, 26) : 'Knowledge Map'}
          </h1>
          <p className="font-mono text-[12px] leading-4 text-white/45">
            {focusGoal ? 'prerequisite skill tree' : `${g.goals.length} topic${g.goals.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <button
          onClick={load}
          aria-label="Refresh"
          className="grid h-9 w-9 place-items-center rounded-full text-white/55 hover:bg-white/10 hover:text-white"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M4 12a8 8 0 1 1 2.3 5.6M4 18v-4h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {status === 'error' && (
          <div className="absolute inset-0 z-10 grid place-items-center px-8 text-center">
            <p className="text-[13px] text-red-300">Couldn’t load. {error}</p>
          </div>
        )}
        {status === 'ready' && g.goals.length === 0 && (
          <div className="absolute inset-0 grid place-items-center px-8 text-center">
            <p className="text-[14px] text-white/70">
              No topics yet.
              <br />
              <span className="text-white/45 text-[13px]">Add a class in Learn — it appears here with its prerequisites.</span>
            </p>
          </div>
        )}

        <svg
          ref={svgRef}
          viewBox={`0 0 ${VBW} ${VBH}`}
          preserveAspectRatio="xMidYMid meet"
          className="h-full w-full touch-none select-none"
          onPointerMove={focusGoal ? undefined : onMove}
          onPointerUp={focusGoal ? undefined : onUp}
          onPointerLeave={focusGoal ? undefined : onUp}
        >
          {focusGoal && tree ? (
            <>
              {tree.edges.map(([from, to], i) => {
                const a = tree.pos.get(from)
                const b = tree.pos.get(to)
                if (!a || !b) return null
                return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#3a4150" strokeWidth="1.5" />
              })}
              {tree.ids.map((id) => {
                const n = nodeById.get(id)
                const p = tree.pos.get(id)
                if (!n || !p) return null
                return <Node key={id} n={n} x={p.x} y={p.y} r={n.is_goal ? 13 : 9} onClick={(e) => e.stopPropagation()} />
              })}
            </>
          ) : (
            <>
              {overviewEdges.map((e) => {
                const a = layout.positions.get(e.from)
                const b = layout.positions.get(e.to)
                if (!a || !b) return null
                return <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#2b3344" strokeWidth="1.5" />
              })}
              {g.goals.map((n) => {
                const p = layout.positions.get(n.id)
                if (!p) return null
                return (
                  <g
                    key={n.id}
                    onPointerDown={(e) => onNodeDown(e, n.id)}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (!moved.current) setFocusGoal(n.id)
                    }}
                  >
                    <Node n={n} x={p.x} y={p.y} r={14} />
                  </g>
                )
              })}
            </>
          )}
        </svg>

        {/* legend */}
        <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1 rounded-md bg-white/5 px-2.5 py-1.5 text-[11px] text-white/70 backdrop-blur-sm">
          {focusGoal ? (
            <>
              <span className="flex items-center gap-1.5"><Dot c={COL.ready.ring} /> Ready</span>
              <span className="flex items-center gap-1.5"><Dot c={COL.mastered.ring} /> Mastered</span>
              <span className="flex items-center gap-1.5"><Dot c={COL.locked.ring} /> Locked</span>
            </>
          ) : (
            <span className="flex items-center gap-1.5"><Dot c={COL.goal.ring} /> Tap a topic for its skill tree</span>
          )}
        </div>
      </div>
    </div>
  )
}

function Dot({ c }) {
  return <span className="h-2.5 w-2.5 rounded-full" style={{ background: c }} />
}
