import { useEffect, useRef, useState, type PointerEvent as RPE } from 'react'
import type { Mode } from '../engine/engine'
import { N, SPAN, HALF, CELL, ROAD } from '../engine/city'
import { IS_TOUCH, type Eng } from './eng'

const MAP = 148
const VIEW = 88
const ZONE_FILL: Record<string, string> = { park: 'rgba(74,222,128,0.5)', market: 'rgba(251,191,36,0.5)', plaza: 'rgba(129,140,248,0.5)' }

export function MiniMap({ eng }: { eng: () => Eng | null }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current!
    const D = Math.min(2, window.devicePixelRatio || 1)
    cv.width = cv.height = MAP * D
    const ctx = cv.getContext('2d')!
    ctx.scale(D, D)
    const C = MAP / 2
    const s = C / VIEW
    const px = (v: number) => (v + HALF) * s
    const base = document.createElement('canvas')
    base.width = base.height = Math.ceil(SPAN * s * D)
    const b = base.getContext('2d')!
    b.scale(D, D)
    b.fillStyle = '#0e131b'
    b.fillRect(0, 0, SPAN * s, SPAN * s)
    b.fillStyle = '#232d38'
    const W = (CELL - ROAD) * s
    for (let i = 0; i < N - 1; i++) {
      for (let j = 0; j < N - 1; j++) b.fillRect(px(-HALF + i * CELL + ROAD / 2), px(-HALF + j * CELL + ROAD / 2), W, W)
    }
    let raf = 0, last = 0
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw)
      if (t - last < 66) return
      last = t
      const h = eng()?.hud()
      if (!h) return
      const ox = C - px(h.x)
      const oy = C - px(h.z)
      ctx.save()
      ctx.beginPath()
      ctx.arc(C, C, C, 0, Math.PI * 2)
      ctx.clip()
      ctx.fillStyle = '#0e131b'
      ctx.fillRect(0, 0, MAP, MAP)
      ctx.translate(C, C)
      ctx.rotate(h.yaw - Math.PI)
      ctx.translate(-C, -C)
      ctx.drawImage(base, 0, 0, base.width, base.height, ox, oy, SPAN * s, SPAN * s)
      for (const z of h.zones) {
        if (Math.hypot(px(z.x) + ox - C, px(z.z) + oy - C) > C + W) continue
        ctx.fillStyle = ZONE_FILL[z.kind]
        ctx.fillRect(px(z.x) + ox - W / 2, px(z.z) + oy - W / 2, W, W)
      }
      ctx.fillStyle = '#dbe4ee'
      for (let k = 0; k < h.cars.n; k++) {
        const cx = px(h.cars.x[k]) + ox - C
        const cz = px(h.cars.z[k]) + oy - C
        if (Math.hypot(cx, cz) > C) continue
        ctx.fillRect(cx + C - 1.5, cz + C - 1.5, 3, 3)
      }
      ctx.restore()
      ctx.fillStyle = '#38bdf8'
      ctx.beginPath()
      ctx.moveTo(C, C - 6)
      ctx.lineTo(C + 4, C + 5)
      ctx.lineTo(C - 4, C + 5)
      ctx.closePath()
      ctx.fill()
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <canvas
      ref={ref}
      style={{ width: MAP, height: MAP }}
      className={`pointer-events-none absolute rounded-full border border-white/10 shadow-lg ${IS_TOUCH ? 'right-3 top-14' : 'bottom-4 left-4'}`}
    />
  )
}

const BEARINGS = ['B', 'ĐB', 'Đ', 'ĐN', 'N', 'TN', 'T', 'TB']

export function Compass({ eng }: { eng: () => Eng | null }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const W = 200
    const PPD = W / 120
    let raf = 0, last = 0
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw)
      if (t - last < 66) return
      last = t
      const h = eng()?.hud()
      const el = ref.current
      if (!h || !el) return
      const bearing = (((Math.atan2(Math.sin(h.yaw), -Math.cos(h.yaw)) * 180) / Math.PI + 360) % 360)
      for (const [k, c] of [...el.children].entries()) {
        const d = ((((k * 45 - bearing) % 360) + 540) % 360) - 180
        const s = (c as HTMLElement).style
        s.left = `${W / 2 + d * PPD}px`
        s.opacity = Math.abs(d) < 58 ? '1' : '0'
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <div ref={ref} className="pointer-events-none absolute left-1/2 top-[max(0.5rem,env(safe-area-inset-top))] h-5 w-52 -translate-x-1/2 overflow-hidden rounded-md bg-black/45 text-[10px] font-semibold tracking-wide text-slate-100 backdrop-blur-sm">
      {BEARINGS.map((l) => (
        <span key={l} className="absolute -translate-x-1/2 tabular-nums">{l}</span>
      ))}
    </div>
  )
}

const POI_LABEL: Record<string, string> = { park: 'Công viên', market: 'Chợ', plaza: 'Quảng trường', tower: 'Toà tháp' }

export function PoiMarkers({ eng }: { eng: () => Eng | null }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0, last = 0
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw)
      if (t - last < 66) return
      last = t
      const e = eng(), el = ref.current
      const h = e?.hud()
      if (!e || !h || !el) return
      const near = h.zones
        .map((z) => ({ z, d: Math.hypot(h.x - z.x, h.z - z.z) }))
        .filter((o) => o.d < 50)
        .sort((a, b) => a.d - b.d)
      for (const [i, c] of [...el.children].entries()) {
        const s = (c as HTMLElement).style
        const o = near[i]
        if (!o) {
          s.opacity = '0'
          continue
        }
        const p = e.project(o.z.x, o.z.kind === 'tower' ? 78 : 11, o.z.z)
        s.transform = `translate(${p.sx.toFixed(0)}px,${p.sy.toFixed(0)}px) translate(-50%,-100%)`
        s.opacity = p.front ? String(Math.max(0.35, 1 - o.d / 55)) : '0'
        ;(c as HTMLElement).textContent = POI_LABEL[o.z.kind]
      }
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 overflow-hidden">
      {Array.from({ length: 8 }, (_, i) => (
        <span key={i} className="absolute left-0 top-0 rounded-md bg-black/55 px-2 py-1 text-[10px] font-medium text-slate-100 opacity-0 backdrop-blur-sm" />
      ))}
    </div>
  )
}

export function TouchControls({ eng, mode }: { eng: () => Eng | null; mode: Mode }) {
  const [knob, setKnob] = useState<{ bx: number; by: number; kx: number; ky: number } | null>(null)
  const [running, setRunning] = useState(false)
  const joy = useRef<{ id: number; bx: number; by: number } | null>(null)
  const look = useRef<{ id: number; x: number; y: number } | null>(null)
  const move = useRef({ x: 0, z: 0 })
  const lastTap = useRef(0)

  const push = (run: boolean) => eng()?.setMove(move.current.x, move.current.z, run)

  const joyDown = (e: RPE<HTMLDivElement>) => {
    e.stopPropagation()
    if (joy.current) return
    eng()?.resumeAudio()
    joy.current = { id: e.pointerId, bx: e.clientX, by: e.clientY }
    move.current = { x: 0, z: 0 }
    const now = performance.now()
    let run = running
    if (now - lastTap.current < 300) { run = !run; setRunning(run); lastTap.current = 0 } else lastTap.current = now
    setKnob({ bx: e.clientX, by: e.clientY, kx: e.clientX, ky: e.clientY })
    e.currentTarget.setPointerCapture(e.pointerId)
    push(run)
  }
  const joyMove = (e: RPE<HTMLDivElement>) => {
    const j = joy.current
    if (!j || j.id !== e.pointerId) return
    const r = 56
    let dx = e.clientX - j.bx
    let dy = e.clientY - j.by
    const len = Math.hypot(dx, dy)
    if (len > 0) { const m = Math.min(1, len / r); dx = (dx / len) * m; dy = (dy / len) * m }
    move.current = { x: dx, z: dy }
    setKnob({ bx: j.bx, by: j.by, kx: j.bx + dx * r, ky: j.by + dy * r })
    push(running)
  }
  const joyUp = (e: RPE<HTMLDivElement>) => {
    if (!joy.current || joy.current.id !== e.pointerId) return
    joy.current = null
    move.current = { x: 0, z: 0 }
    setKnob(null)
    push(running)
  }

  const lookDown = (e: RPE<HTMLDivElement>) => {
    if (look.current) return
    eng()?.resumeAudio()
    look.current = { id: e.pointerId, x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const lookMove = (e: RPE<HTMLDivElement>) => {
    const l = look.current
    if (!l || l.id !== e.pointerId) return
    eng()?.look(e.clientX - l.x, e.clientY - l.y)
    l.x = e.clientX
    l.y = e.clientY
  }
  const lookUp = (e: RPE<HTMLDivElement>) => {
    if (look.current?.id === e.pointerId) look.current = null
  }

  return (
    <div className="absolute inset-0">
      <div className="absolute inset-y-0 right-0 w-1/2 touch-none"
        onPointerDown={lookDown} onPointerMove={lookMove} onPointerUp={lookUp} onPointerCancel={lookUp} />
      <div className="absolute bottom-0 left-0 h-2/3 w-1/2 touch-none"
        onPointerDown={joyDown} onPointerMove={joyMove} onPointerUp={joyUp} onPointerCancel={joyUp}>
        {knob && (
          <>
            <div className="pointer-events-none absolute h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/25" style={{ left: knob.bx, top: knob.by }} />
            <div className="pointer-events-none absolute h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/40" style={{ left: knob.kx, top: knob.ky }} />
          </>
        )}
      </div>
      <div className="pointer-events-none absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-4 rounded-md bg-black/40 px-2 py-1.5 text-[10px] text-white/70">
        {running ? '🏃 đang chạy' : '🚶 đang đi'} · chạm kép để đổi
      </div>
      <button
        className="absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-3 rounded-full border border-white/15 bg-black/55 px-5 py-3 text-[12px] font-medium text-slate-100 backdrop-blur"
        onClick={() => eng()?.setMode(mode === 'player' ? 'observe' : 'player')}
      >
        {mode === 'player' ? '👁 Quan sát' : '🚶 Điều khiển'}
      </button>
    </div>
  )
}
