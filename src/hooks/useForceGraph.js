import { useEffect, useRef, useState } from 'react'

// Tiny dependency-free force-directed layout. Good for the small personal
// knowledge graphs we render (tens of nodes). Repulsion spreads nodes,
// springs pull linked nodes together, gravity keeps it centered. Nodes can be
// dragged (pinned while held). Honors reduced-motion by settling instantly.

const KREP = 4200 // node-node repulsion (higher = more spread)
const KSPR = 0.05 // edge spring stiffness
const KGRAV = 0.02 // pull toward center
const DAMP = 0.82 // velocity damping
const L = 74 // ideal edge length
const MARGIN = 26
const MINSEP = 42 // hard minimum gap between any two nodes (no overlaps)

export default function useForceGraph(nodes, edges, { width, height, reduced }) {
  const [, setTick] = useState(0)
  const pos = useRef(new Map())
  const vel = useRef(new Map())
  const pinned = useRef(new Set())
  const raf = useRef(0)
  const data = useRef({ nodes, edges })
  data.current = { nodes, edges }

  // place new nodes, drop removed ones, then (re)heat the simulation
  useEffect(() => {
    const cx = width / 2
    const cy = height / 2
    nodes.forEach((n, i) => {
      if (pos.current.has(n.id)) return
      const link = edges.find((e) => e.from === n.id || e.to === n.id)
      const anchor = link ? pos.current.get(link.from === n.id ? link.to : link.from) : null
      const base = anchor || { x: cx, y: cy }
      const a = i * 2.39996 // golden-angle scatter
      pos.current.set(n.id, {
        x: base.x + Math.cos(a) * 64 + (Math.random() - 0.5) * 24,
        y: base.y + Math.sin(a) * 64 + (Math.random() - 0.5) * 24,
      })
      vel.current.set(n.id, { x: 0, y: 0 })
    })
    const live = new Set(nodes.map((n) => n.id))
    for (const id of [...pos.current.keys()]) {
      if (!live.has(id)) {
        pos.current.delete(id)
        vel.current.delete(id)
      }
    }
    heat()
    return () => cancelAnimationFrame(raf.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, width, height])

  function step(alpha) {
    const { nodes: ns, edges: es } = data.current
    const cx = width / 2
    const cy = height / 2
    const disp = new Map(ns.map((n) => [n.id, { x: 0, y: 0 }]))

    for (let i = 0; i < ns.length; i++) {
      for (let j = i + 1; j < ns.length; j++) {
        const a = pos.current.get(ns[i].id)
        const b = pos.current.get(ns[j].id)
        if (!a || !b) continue
        let dx = a.x - b.x
        let dy = a.y - b.y
        let d2 = dx * dx + dy * dy || 0.01
        const d = Math.sqrt(d2)
        const f = KREP / d2
        const fx = (dx / d) * f
        const fy = (dy / d) * f
        const da = disp.get(ns[i].id)
        const db = disp.get(ns[j].id)
        da.x += fx
        da.y += fy
        db.x -= fx
        db.y -= fy
      }
    }

    for (const e of es) {
      const a = pos.current.get(e.from)
      const b = pos.current.get(e.to)
      if (!a || !b) continue
      let dx = b.x - a.x
      let dy = b.y - a.y
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01
      const f = (d - L) * KSPR
      const fx = (dx / d) * f
      const fy = (dy / d) * f
      const da = disp.get(e.from)
      const db = disp.get(e.to)
      if (da) {
        da.x += fx
        da.y += fy
      }
      if (db) {
        db.x -= fx
        db.y -= fy
      }
    }

    for (const n of ns) {
      const p = pos.current.get(n.id)
      const dd = disp.get(n.id)
      if (!p || !dd) continue
      dd.x += (cx - p.x) * KGRAV
      dd.y += (cy - p.y) * KGRAV
      if (pinned.current.has(n.id)) continue
      const v = vel.current.get(n.id)
      v.x = (v.x + dd.x) * DAMP
      v.y = (v.y + dd.y) * DAMP
      p.x = clamp(p.x + v.x * alpha, MARGIN, width - MARGIN)
      p.y = clamp(p.y + v.y * alpha, MARGIN, height - MARGIN)
    }

    // Hard collision pass: directly push apart any pair closer than MINSEP, so
    // nodes never overlap and connected nodes stay visually separable.
    for (let i = 0; i < ns.length; i++) {
      for (let j = i + 1; j < ns.length; j++) {
        const a = pos.current.get(ns[i].id)
        const b = pos.current.get(ns[j].id)
        if (!a || !b) continue
        let dx = b.x - a.x
        let dy = b.y - a.y
        let d = Math.sqrt(dx * dx + dy * dy) || 0.01
        if (d >= MINSEP) continue
        const push = (MINSEP - d) / 2
        const nx = dx / d
        const ny = dy / d
        const ai = pinned.current.has(ns[i].id)
        const bi = pinned.current.has(ns[j].id)
        if (!ai) {
          a.x = clamp(a.x - nx * push, MARGIN, width - MARGIN)
          a.y = clamp(a.y - ny * push, MARGIN, height - MARGIN)
        }
        if (!bi) {
          b.x = clamp(b.x + nx * push, MARGIN, width - MARGIN)
          b.y = clamp(b.y + ny * push, MARGIN, height - MARGIN)
        }
      }
    }
    return alpha * 0.95
  }

  function heat() {
    cancelAnimationFrame(raf.current)
    if (reduced) {
      let a = 1
      for (let i = 0; i < 160; i++) a = step(a)
      setTick((t) => t + 1)
      return
    }
    let alpha = 1
    const loop = () => {
      alpha = step(alpha)
      setTick((t) => t + 1)
      if (alpha > 0.02) raf.current = requestAnimationFrame(loop)
    }
    raf.current = requestAnimationFrame(loop)
  }

  const api = {
    positions: pos.current,
    pinned: pinned.current,
    setPos(id, x, y) {
      const p = pos.current.get(id)
      if (p) {
        p.x = clamp(x, MARGIN, width - MARGIN)
        p.y = clamp(y, MARGIN, height - MARGIN)
        setTick((t) => t + 1)
      }
    },
    pin(id) {
      pinned.current.add(id)
    },
    unpin(id) {
      pinned.current.delete(id)
      heat()
    },
    reheat: heat,
  }
  return api
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v))
}
