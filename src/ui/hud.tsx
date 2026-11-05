import { useEffect, useRef, useState, type PointerEvent as RPE } from 'react'
import type { Mode } from '../engine/types'
import { IS_TOUCH, type Eng } from './eng'

const MAP = 148
const VIEW = 88
const ZONE_FILL: Record<string, string> = { park: 'rgba(74,222,128,0.5)', market: 'rgba(251,191,36,0.5)', plaza: 'rgba(129,140,248,0.5)', tower: 'rgba(148,163,184,0.6)', residential: 'rgba(244,114,182,0.5)', industrial: 'rgba(161,98,7,0.55)' }

const LAYERS = [
  { key: 'shops', label: 'Cửa hàng', color: '#fbbf24' },
  { key: 'benches', label: 'Ghế', color: '#4ade80' },
  { key: 'bikes', label: 'Xe đạp', color: '#22d3ee' },
  { key: 'food', label: 'Hàng quán', color: '#f472b6' },
  { key: 'busker', label: 'Nghệ sĩ', color: '#c084fc' },
] as const
type LayerKey = (typeof LAYERS)[number]['key']

export function MiniMap({ eng }: { eng: () => Eng | null }) {
  const ref = useRef<HTMLCanvasElement>(null)
  const [on, setOn] = useState<Record<LayerKey, boolean>>({ shops: true, benches: true, bikes: true, food: true, busker: true })
  const onRef = useRef(on)
  onRef.current = on
  useEffect(() => {
    const cv = ref.current!
    const D = Math.min(2, window.devicePixelRatio || 1)
    cv.width = cv.height = MAP * D
    const ctx = cv.getContext('2d')!
    ctx.scale(D, D)
    const C = MAP / 2
    const s = C / VIEW
    let base: HTMLCanvasElement | null = null
    let px = (v: number) => v
    let W = 0, spanPx = 0
    let pois: ReturnType<Eng['pois']> | null = null
    // effect của con chạy trước effect của cha nên engine chưa tồn tại lúc này — dựng base ở frame đầu
    const buildBase = () => {
      const g = eng()!.grid()
      px = (v: number) => (v + g.HALF) * s
      W = (g.CELL - g.ROAD) * s
      spanPx = g.SPAN * s
      base = document.createElement('canvas')
      base.width = base.height = Math.ceil(spanPx * D)
      const b = base.getContext('2d')!
      b.scale(D, D)
      b.fillStyle = '#0e131b'
      b.fillRect(0, 0, spanPx, spanPx)
      b.fillStyle = '#232d38'
      for (let i = 0; i < g.N - 1; i++) {
        for (let j = 0; j < g.N - 1; j++) b.fillRect(px(-g.HALF + i * g.CELL + g.ROAD / 2), px(-g.HALF + j * g.CELL + g.ROAD / 2), W, W)
      }
      pois = eng()!.pois()
    }
    const dot = (x: number, z: number, ox: number, oy: number, color: string) => {
      const sx = px(x) + ox - C
      const sz = px(z) + oy - C
      if (Math.hypot(sx - C, sz - C) > C) return
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(sx, sz, 2.2, 0, Math.PI * 2)
      ctx.fill()
    }
    let raf = 0, last = 0
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw)
      if (t - last < 66) return
      last = t
      const h = eng()?.hud()
      if (!h) return
      if (!base) buildBase()
      const bs = base!
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
      ctx.drawImage(bs, 0, 0, bs.width, bs.height, ox, oy, spanPx, spanPx)
      for (const z of h.zones) {
        if (Math.hypot(px(z.x) + ox - C, px(z.z) + oy - C) > C + W) continue
        ctx.fillStyle = ZONE_FILL[z.kind]
        ctx.fillRect(px(z.x) + ox - W / 2, px(z.z) + oy - W / 2, W, W)
      }
      if (pois) {
        const L = onRef.current
        if (L.food) for (const p of pois.food) dot(p.x, p.z, ox, oy, '#f472b6')
        if (L.bikes) for (const p of pois.bikes) dot(p.x, p.z, ox, oy, '#22d3ee')
        if (L.benches) for (const p of pois.benches) dot(p.x, p.z, ox, oy, '#4ade80')
        if (L.shops) for (const p of pois.shops) dot(p.x, p.z, ox, oy, '#fbbf24')
        if (L.busker) dot(pois.busker.x, pois.busker.z, ox, oy, '#c084fc')
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
    <>
      <canvas
        ref={ref}
        style={{ width: MAP, height: MAP }}
        className={`pointer-events-none absolute rounded-full border border-white/10 shadow-lg ${IS_TOUCH ? 'right-3 top-14' : 'bottom-4 left-4'}`}
      />
      <div className={`absolute flex flex-wrap gap-1 ${IS_TOUCH ? 'right-3 top-[calc(3.5rem+154px)] max-w-[150px] justify-end' : 'bottom-[calc(1rem+156px)] left-4'}`}>
        {LAYERS.map((l) => (
          <button
            key={l.key}
            onClick={() => setOn((o) => ({ ...o, [l.key]: !o[l.key] }))}
            className={`flex min-h-11 items-center gap-1.5 rounded-md border px-2 text-[10px] font-medium backdrop-blur transition ${on[l.key] ? 'border-white/15 bg-black/55 text-slate-100' : 'border-white/5 bg-black/30 text-slate-500'}`}
          >
            <span className="h-2 w-2 rounded-full" style={{ background: l.color, opacity: on[l.key] ? 1 : 0.3 }} />
            {l.label}
          </button>
        ))}
      </div>
    </>
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
    <div ref={ref} className="pointer-events-none absolute left-1/2 top-[max(0.5rem,env(safe-area-inset-top))] h-5 w-44 -translate-x-1/2 overflow-hidden rounded-md bg-black/45 text-[10px] font-semibold tracking-wide text-slate-100 backdrop-blur-sm">
      {BEARINGS.map((l) => (
        <span key={l} className="absolute -translate-x-1/2 tabular-nums">{l}</span>
      ))}
    </div>
  )
}

const POI_LABEL: Record<string, string> = { park: 'Công viên', market: 'Chợ', plaza: 'Quảng trường', tower: 'Toà tháp', residential: 'Dân cư', industrial: 'Khu công nghiệp' }

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

const HINTS_KEY = 'cs.hints'
const loadHints = (): Set<string> => {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(HINTS_KEY) || '[]') as string[])
  } catch {
    return new Set<string>()
  }
}
const MODE_TEXT = [
  'Đi bộ — WASD để dạo, chuột để nhìn, giữ Shift để chạy.',
  'Quan sát — O (hoặc nút 👁) để phóng camera tự do quanh phố.',
  'Lái xe — lại gần một chiếc xe rồi nhấn E để lên, E lần nữa để xuống.',
  'Chụp ảnh — F (hoặc nút 📷) để mở máy ảnh, đổi bộ lọc và lưu ảnh.',
]

// E8: context hints that only surface next to the thing they describe, and never again once shown.
export function ContextHint({ eng, started, intro, setIntro }: { eng: () => Eng | null; started: boolean; intro: boolean; setIntro: (v: boolean) => void }) {
  const [learned, setLearned] = useState<Set<string>>(loadHints)
  const [text, setText] = useState<string | null>(null)
  const last = useRef<string | null>(null)
  const rainId = useRef<number>(0)

  const persist = (k: string) => setLearned((p) => { if (p.has(k)) return p; const n = new Set(p); n.add(k); localStorage.setItem(HINTS_KEY, JSON.stringify([...n])); return n })

  useEffect(() => {
    if (!started) return
    const id = setInterval(() => {
      const h = eng()?.hint()
      const k = h && !learned.has(h.key) ? h.key : null
      if (k === last.current) return
      if (last.current === 'rain' && k !== 'rain') { clearTimeout(rainId.current); rainId.current = 0 }
      last.current = k
      setText(k ? h!.text : null)
      if (k === 'drive') persist(k)
      else if (k === 'rain') { rainId.current = window.setTimeout(() => persist('rain'), 6000) }
      else if (k) persist(k)
    }, 300)
    return () => { clearInterval(id); clearTimeout(rainId.current) }
  }, [started, learned])

  const closeIntro = () => { localStorage.setItem('cs.intro', '1'); setIntro(false) }

  return (
    <>
      {text && (
        <div className={`pointer-events-none absolute rounded-md border border-sky-300/25 bg-black/55 px-3 py-1.5 text-[11px] text-slate-100 backdrop-blur ${IS_TOUCH ? 'bottom-[max(4.5rem,calc(env(safe-area-inset-bottom)+2rem))] left-1/2 -translate-x-1/2' : 'bottom-5 right-4'}`}>
          {text}
        </div>
      )}
      {intro && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm" onClick={closeIntro}>
          <div className="pointer-events-auto rounded-xl border border-white/10 bg-black/45 p-5 text-[11px] text-slate-200 shadow-lg backdrop-blur-md max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="text-[13px] font-semibold tracking-wide text-white">Bốn cách ngắm thành phố</div>
            {MODE_TEXT.map((t, i) => (
              <div key={i} className="flex gap-2.5 text-[12px] leading-relaxed text-slate-200">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sky-300" />
                <span>{t}</span>
              </div>
            ))}
            <button className="rounded-md bg-white/5 px-2.5 py-1 text-[10px] font-medium text-slate-300 transition hover:bg-white/10 w-full" onClick={closeIntro}>
              Đã hiểu
            </button>
          </div>
        </div>
      )}
    </>
  )
}

export function TouchControls({ eng, mode, photo }: { eng: () => Eng | null; mode: Mode; photo: boolean }) {
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
        className={`absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-3 rounded-full border border-white/15 bg-black/55 px-5 py-3 text-[12px] font-medium text-slate-100 backdrop-blur ${photo ? 'pointer-events-none opacity-0' : ''}`}
        onClick={() => eng()?.setMode(mode === 'player' ? 'observe' : 'player')}
      >
        {mode === 'player' ? '👁 Quan sát' : '🚶 Điều khiển'}
      </button>
    </div>
  )
}
