import { useEffect, useRef, useState } from 'react'
import { FILTERS, type Effects, type Filter, type Tier } from './engine/types'
import { useGame } from './useGame'
import { IS_TOUCH } from './ui/eng'
import { MiniMap, Compass, PoiMarkers, TouchControls, ContextHint } from './ui/hud'
import { Key, Row, Slider } from './ui/primitives'

const fmtHour = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`
const timeLabel = (h: number) => {
  if (h < 5 || h >= 22) return 'Đêm khuya'
  if (h < 6.5) return 'Bình minh'
  if (h < 9) return 'Sáng sớm'
  if (h < 11.5) return 'Buổi sáng'
  if (h < 13.5) return 'Giữa trưa'
  if (h < 16.5) return 'Buổi chiều'
  if (h < 18.5) return 'Chạng vạng'
  if (h < 20) return 'Hoàng hôn'
  return 'Buổi tối'
}

const FX_LABELS: Record<keyof Effects, string> = { shadows: 'Bóng đổ', ao: 'AO', bloom: 'Bloom', rays: 'Tia sáng', grain: 'Hạt phim', grade: 'Màu' }

const SHOTS = 'cs.shots'
const loadShots = () => {
  try {
    return JSON.parse(localStorage.getItem(SHOTS) || '[]') as string[]
  } catch {
    return []
  }
}
const thumb = (url: string) =>
  new Promise<string>((res) => {
    const im = new Image()
    im.onload = () => {
      const c = document.createElement('canvas')
      c.width = 320
      c.height = (320 * im.height) / im.width
      c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height)
      res(c.toDataURL('image/jpeg', 0.7))
    }
    im.src = url
  })

const TUTORIAL = ['WASD để đi · chuột để nhìn', 'Giữ Shift để chạy nhanh', 'Lại gần rồi bấm E để tương tác', 'Bấm F để mở chế độ chụp ảnh']

// E9 photo frame: preview aspect and its capture resolution (both share the ratio).
type Aspect = '16:9' | '4:3' | '1:1'
const ASPECT_SIZE: Record<Aspect, [number, number]> = { '16:9': [3840, 2160], '4:3': [3200, 2400], '1:1': [2160, 2160] }
const ZONE_NAME: Record<string, string> = { park: 'Công viên', market: 'Chợ', plaza: 'Quảng trường', tower: 'Toà tháp', residential: 'Dân cư', industrial: 'Khu công nghiệp' }

// burn place + time onto the still, bottom-left, before it hits the gallery / download
async function watermark(url: string, text: string): Promise<string> {
  const im = new Image()
  await new Promise((r) => { im.onload = () => r(0); im.src = url })
  const c = document.createElement('canvas')
  c.width = im.width
  c.height = im.height
  const x = c.getContext('2d')!
  x.drawImage(im, 0, 0)
  const fs = Math.round(im.height * 0.026)
  x.font = `600 ${fs}px system-ui, sans-serif`
  x.textBaseline = 'bottom'
  x.shadowColor = 'rgba(0,0,0,0.65)'
  x.shadowBlur = fs * 0.5
  x.fillStyle = 'rgba(255,255,255,0.86)'
  x.fillText(text, Math.round(im.width * 0.022), im.height - Math.round(im.width * 0.022))
  return c.toDataURL('image/png')
}

const PHOTO_PRESETS: Record<string, { filter: Filter; exposure: number; vignette: number; dof: boolean; focus: number; aperture: number; rain?: number; h?: number }> = {
  Cinematic: { filter: 'film', exposure: 0.95, vignette: 0.62, dof: true, focus: 14, aperture: 0.4 },
  Noir: { filter: 'noir', exposure: 1.0, vignette: 0.78, dof: false, focus: 12, aperture: 0.3 },
  'Đêm mưa': { filter: 'cool', exposure: 0.9, vignette: 0.7, dof: true, focus: 10, aperture: 0.5, rain: 0.85, h: 21.5 },
  'Hoàng hôn': { filter: 'warm', exposure: 1.06, vignette: 0.5, dof: false, focus: 12, aperture: 0.3 },
  'Đơn sắc': { filter: 'noir', exposure: 1.0, vignette: 0.4, dof: false, focus: 12, aperture: 0.3 },
}

// E11 accessibility: persisted to cs.a11y. reduce-motion/no-lightning/keymap flow to the engine,
// the 5 volumes trim WebAudio categories, contrast + hudScale are pure CSS on the React side.
type A11y = {
  reduceMotion: boolean
  noLightning: boolean
  contrast: boolean
  hudScale: number
  vol: { ambience: number; vehicles: number; weather: number; interaction: number; footsteps: number }
  keymap: { interact: string; mode: string; pause: string; photo: string }
}
const A11Y_KEY = 'cs.a11y'
const DEFAULT_A11Y: A11y = {
  reduceMotion: false, noLightning: false, contrast: false, hudScale: 1,
  vol: { ambience: 1, vehicles: 1, weather: 1, interaction: 1, footsteps: 1 },
  keymap: { interact: 'KeyE', mode: 'KeyO', pause: 'KeyP', photo: 'KeyF' },
}
const loadA11y = (): A11y => {
  try {
    const s = JSON.parse(localStorage.getItem(A11Y_KEY) || '{}') as Partial<A11y>
    return { ...DEFAULT_A11Y, ...s, vol: { ...DEFAULT_A11Y.vol, ...s.vol }, keymap: { ...DEFAULT_A11Y.keymap, ...s.keymap } }
  } catch {
    return DEFAULT_A11Y
  }
}
const KEY_NAMES: Record<string, string> = { Space: 'Cách', Escape: 'Esc', Enter: 'Enter', ShiftLeft: 'Shift trái', ShiftRight: 'Shift phải', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' }
const keyLabel = (code: string) => KEY_NAMES[code] ?? code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Numpad/, 'num ')
const VOL_ROWS: [keyof A11y['vol'], string][] = [['ambience', 'Âm thanh chung'], ['vehicles', 'Xe cộ'], ['weather', 'Mưa · sấm'], ['interaction', 'Tương tác'], ['footsteps', 'Tiếng bước']]
const KEYMAP_ROWS: [keyof A11y['keymap'], string][] = [['interact', 'Tương tác'], ['mode', 'Đổi chế độ'], ['pause', 'Dừng giờ'], ['photo', 'Chụp ảnh']]

export default function App() {
  const [photo, setPhoto] = useState(false)
  const [started, setStarted] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [line, setLine] = useState<{ t: string; n: number } | null>(null)
  const [shots, setShots] = useState<string[]>(loadShots)
  const [gallery, setGallery] = useState(false)
  const [tut, setTut] = useState(0)
  const [intro, setIntro] = useState(false)
  const [aspect, setAspect] = useState<Aspect>('16:9')
  const [pexp, setPexp] = useState(1)
  const [pvig, setPvig] = useState(0.45)
  const [pdof, setPdof] = useState(false)
  const [pfocus, setPfocus] = useState(12)
  const [pap, setPap] = useState(0.6)
  const [a11y, setA11y] = useState<A11y>(loadA11y)
  const [listen, setListen] = useState<null | keyof A11y['keymap']>(null)

  // push persisted/edited a11y into the engine and localStorage; re-runs at start because the
  // engine (createEngine) is only built after this effect's first mount pass, so eng() is null then
  useEffect(() => {
    eng()?.setA11y({ reduceMotion: a11y.reduceMotion, noLightning: a11y.noLightning, keymap: a11y.keymap })
    eng()?.setVolumes(a11y.vol)
    localStorage.setItem(A11Y_KEY, JSON.stringify(a11y))
  }, [a11y, started])

  // capture the next key for whichever action chip is in "listening" state; capture-phase so the
  // game's own keydown handler never sees it, Esc cancels
  useEffect(() => {
    if (!listen) return
    const h = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.code !== 'Escape') setA11y((a) => ({ ...a, keymap: { ...a.keymap, [listen]: e.code } }))
      setListen(null)
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [listen])

  // photo look controls flow to the engine whenever they change; harmless no-ops while tier=low
  // (no composer) or grade/grain off (that control just won't take effect)
  useEffect(() => {
    eng()?.setPhoto({ exposure: pexp, vignette: pvig, dof: pdof, dofFocus: pfocus, dofAperture: pap })
  }, [pexp, pvig, pdof, pfocus, pap])

  const { canvasRef, eng, stats, settings: cfg, patch, toggleFx, togglePause, startEngine } =
    useGame((t) => setLine((p) => ({ t, n: (p?.n ?? 0) + 1 })))
  const { tier, mode, h: hour, scale, bloom, rays, motion, ca, rain, ambient, filter, effects } = cfg
  const paused = !!stats?.paused

  useEffect(() => {
    if (tut === 1 && stats && stats.speed > 1.2) setTut(2)
    if (tut === 2 && stats && stats.speed > 5) setTut(3)
  }, [stats?.speed, tut])

  useEffect(() => {
    if (photo) setTut((s) => (s === 4 ? 5 : s))
  }, [photo])

  useEffect(() => {
    const ke = (e: KeyboardEvent) => {
      if (e.code === 'KeyE') setTut((s) => (s === 3 ? 4 : s))
    }
    window.addEventListener('keydown', ke)
    return () => window.removeEventListener('keydown', ke)
  }, [])

  useEffect(() => {
    if (!line) return
    const id = setTimeout(() => setLine(null), 4200)
    return () => clearTimeout(id)
  }, [line?.n])

  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (e.code === 'KeyF' && !document.pointerLockElement) setPhoto((p) => !p)
      if (e.code === 'Escape' && photo) setPhoto(false)
    }
    window.addEventListener('keydown', kd)
    return () => window.removeEventListener('keydown', kd)
  }, [photo])

  const [ach, setAch] = useState<{ t: string; n: number } | null>(null)
  const seen = useRef<Set<number>>(new Set())
  const done = useRef({ drive: false, parks: false, shot: false })

  useEffect(() => {
    if (!ach) return
    const id = setTimeout(() => setAch(null), 4200)
    return () => clearTimeout(id)
  }, [ach?.n])

  useEffect(() => {
    if (!stats?.inCar || done.current.drive) return
    done.current.drive = true
    setAch((p) => ({ t: 'Thành tựu · Lần đầu lái xe', n: (p?.n ?? 0) + 1 }))
  }, [stats?.inCar])

  useEffect(() => {
    if (!started) return
    const id = setInterval(() => {
      const h = eng()?.hud()
      if (!h) return
      h.zones.forEach((z, i) => {
        if (z.kind === 'park' && Math.hypot(h.x - z.x, h.z - z.z) < 22) seen.current.add(i)
      })
      if (!done.current.parks && seen.current.size >= 4) {
        done.current.parks = true
        setAch((p) => ({ t: 'Thành tựu · Đã đặt chân tới 4 công viên', n: (p?.n ?? 0) + 1 }))
      }
    }, 800)
    return () => clearInterval(id)
  }, [started])

  const startGame = () => {
    setStarted(true)
    if (!IS_TOUCH) setTut(1)
    if (!localStorage.getItem('cs.intro')) setIntro(true)
    startEngine()
  }

  useEffect(() => {
    if (started) return
    const kd = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'Space') startGame()
    }
    window.addEventListener('keydown', kd)
    return () => window.removeEventListener('keydown', kd)
  }, [started])

  const panel = 'rounded-xl border border-white/10 bg-black/45 backdrop-blur-md text-[11px] text-slate-200 shadow-lg'
  // phones need ~44px targets and notch-safe edges
  const PAD = IS_TOUCH ? 'py-2.5' : 'py-1'
  const BTN = `rounded-md ${PAD} font-medium transition`
  const chip = `rounded-md bg-white/5 ${PAD} ${IS_TOUCH ? 'text-[11px]' : 'text-[10px]'} text-slate-300 transition hover:bg-white/10`
  const btn = (on: boolean) => `${BTN} px-2.5 ${on ? 'bg-sky-400/90 text-slate-950' : 'bg-white/5 text-slate-300 hover:bg-white/10'}`

  const fxBtn = (on: boolean, disabled: boolean) =>
    `${BTN} px-2 ${IS_TOUCH ? 'text-[11px]' : 'text-[10px]'} ${
      disabled
        ? 'bg-white/5 text-slate-600 cursor-not-allowed'
        : on
          ? 'bg-sky-400/90 text-slate-950'
          : 'bg-white/5 text-slate-300 hover:bg-white/10'
    }`

  const TIER_LABELS: { v: Tier; label: string }[] = [
    { v: 'low', label: 'Thấp' },
    { v: 'medium', label: 'Trung bình' },
    { v: 'high', label: 'Cao' },
    { v: 'ultra', label: 'Rất cao' },
    { v: 'max', label: 'Tối đa' },
  ]

  const PRESETS = {
    'Hoàng hôn': { h: 17.3, rain: 0, bloom: 1.0, tier: 'high' as Tier },
    'Đêm mưa': { h: 21.5, rain: 0.85, bloom: 1.5, tier: 'high' as Tier },
    'Giờ cao điểm': { h: 7.5, rain: 0, bloom: 0.8, tier: 'medium' as Tier },
    'Nửa đêm': { h: 0.5, rain: 0, bloom: 1.8, tier: 'ultra' as Tier },
  } as const

  const applyPreset = (p: typeof PRESETS[keyof typeof PRESETS]) => {
    patch({ h: p.h, rain: p.rain, bloom: p.bloom, tier: p.tier })
  }

  const sliderCls = `mt-1 w-full rounded-md border border-white/10 bg-slate-900/80 px-2 ${PAD} text-slate-100 outline-none`

  const AR = Number(aspect.split(':')[0]) / Number(aspect.split(':')[1])
  const applyPhotoPreset = (n: string) => {
    const p = PHOTO_PRESETS[n]
    patch({ filter: p.filter, ...(p.rain !== undefined ? { rain: p.rain } : {}), ...(p.h !== undefined ? { h: p.h } : {}) })
    setPexp(p.exposure); setPvig(p.vignette); setPdof(p.dof); setPfocus(p.focus); setPap(p.aperture)
  }

  const settings = (
    <>
      <button className={`${chip} w-full`} onClick={() => setIntro(true)}>
        🧭 Chỉ dẫn · bốn cách ngắm thành phố
      </button>
      <div className="flex gap-1.5">
        <button className={btn(mode === 'player')} onClick={() => eng()?.setMode('player')}>
          Điều khiển
        </button>
        <button className={btn(mode === 'observe')} onClick={() => eng()?.setMode('observe')}>
          Quan sát
        </button>
        <button className={btn(paused)} onClick={togglePause}>
          {paused ? '⏸' : '▶'}
        </button>
      </div>

      <label className="block">
        <span className="text-slate-400">Chất lượng hình ảnh</span>
        <select className={sliderCls} value={tier} onChange={(e) => patch({ tier: e.target.value as Tier })}>
          <option value="low">Thấp — tắt hậu kỳ</option>
          <option value="medium">Trung bình — AO nhẹ + bloom</option>
          <option value="high">Cao — 2048 bóng, AO rõ</option>
          <option value="ultra">Rất cao — 4096 bóng, ratio 1.6</option>
          <option value="max">Tối đa — 8192 bóng, ratio 2.0</option>
        </select>
      </label>

      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(effects) as (keyof Effects)[]).map((k) => (
          <button key={k} className={fxBtn(effects[k], tier === 'low')} onClick={() => toggleFx(k)} disabled={tier === 'low'}>
            {FX_LABELS[k]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(PRESETS) as (keyof typeof PRESETS)[]).map((k) => (
          <button key={k} className={chip} onClick={() => applyPreset(PRESETS[k])}>
            {k}
          </button>
        ))}
      </div>

      <button className={`${chip} w-full`} onClick={() => eng()?.resetCamera()}>
        ↺ Về điểm xuất phát
      </button>
      <button
        className={`${chip} w-full`}
        onClick={(e) => {
          navigator.clipboard.writeText(location.href)
          const b = e.currentTarget
          b.textContent = '✓ Đã copy'
          setTimeout(() => (b.textContent = '🔗 Copy link'), 1500)
        }}
      >
        🔗 Copy link
      </button>

      <Slider label={`Thời gian thực (${scale}×)`} value={hour} min={0} max={23.99} step={0.01} onChange={(v) => patch({ h: v })}>
        <select className={sliderCls} value={scale} onChange={(e) => patch({ scale: Number(e.target.value) })}>
          <option value={1}>1× — giờ thật</option>
          <option value={60}>60× — 24 phút/ngày</option>
          <option value={240}>240× — 6 phút/ngày</option>
          <option value={1200}>1200× — 72 giây/ngày</option>
        </select>
      </Slider>

      <Slider label={`Độ rực đèn (bloom) ${(bloom * 100).toFixed(0)}%`} value={bloom} min={0} max={2} step={0.05} onChange={(v) => patch({ bloom: v })} />

      <Slider label={`Tia sáng trong không khí ${(rays * 100).toFixed(0)}%`} value={rays} min={0} max={2} step={0.05} onChange={(v) => patch({ rays: v })} />

      <Slider label={`Nhòe chuyển động ${(motion * 100).toFixed(0)}%`} value={motion} min={0} max={1} step={0.05} onChange={(v) => patch({ motion: v })} />

      <Slider label={`Lệ màu viền ${(ca * 100).toFixed(0)}%`} value={ca} min={0} max={1} step={0.05} onChange={(v) => patch({ ca: v })} />

      <Slider label={`Mưa ${(rain * 100).toFixed(0)}%`} value={rain} min={0} max={1} step={0.05} onChange={(v) => patch({ rain: v })} />

      <Slider label={`Âm thanh nền ${(ambient * 100).toFixed(0)}%`} value={ambient} min={0} max={1} step={0.05} onChange={(v) => patch({ ambient: v })} />

      <div className="mt-1 border-t border-white/10 pt-2 text-slate-400">Trợ năng</div>
      <div className="flex flex-wrap gap-1.5">
        <button className={btn(a11y.reduceMotion)} onClick={() => setA11y((a) => ({ ...a, reduceMotion: !a.reduceMotion }))}>Giảm rung lắc</button>
        <button className={btn(a11y.noLightning)} onClick={() => setA11y((a) => ({ ...a, noLightning: !a.noLightning }))}>Tắt sét</button>
        <button className={btn(a11y.contrast)} onClick={() => setA11y((a) => ({ ...a, contrast: !a.contrast }))}>Tương phản cao</button>
      </div>
      <Slider label={`Cỡ chữ giao diện ${(a11y.hudScale * 100).toFixed(0)}%`} value={a11y.hudScale} min={1} max={1.5} step={0.05} onChange={(v) => setA11y((a) => ({ ...a, hudScale: v }))} />
      {VOL_ROWS.map(([k, label]) => (
        <Slider key={k} label={`${label} ${(a11y.vol[k] * 100).toFixed(0)}%`} value={a11y.vol[k]} min={0} max={1} step={0.05} onChange={(v) => setA11y((a) => ({ ...a, vol: { ...a.vol, [k]: v } }))} />
      ))}
      <div className="flex flex-wrap gap-1.5">
        {KEYMAP_ROWS.map(([k, label]) => (
          <button key={k} className={btn(listen === k)} onClick={() => setListen(listen === k ? null : k)}>
            {label}: {keyLabel(a11y.keymap[k])}
          </button>
        ))}
      </div>
      {listen && <div className="text-[10px] text-sky-300">Nhấn phím mới… (Esc để huỷ)</div>}
    </>
  )

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-950">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" style={a11y.contrast ? { filter: 'contrast(1.35) saturate(1.15) brightness(1.05)' } : undefined} />
      <div className="sr-only" role="status" aria-live="polite">
        {!started ? 'Menu thành phố. Nhấn Enter để bắt đầu.' : line ? line.t : mode === 'player' ? 'Đang ở chế độ đi bộ' : 'Đang ở chế độ quan sát'}
      </div>
      {!started && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-end bg-gradient-to-b from-slate-950/70 via-slate-950/20 to-slate-950/90 px-6 pb-[max(4rem,env(safe-area-inset-bottom))] text-center">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_105%,transparent_35%,rgba(5,7,12,0.9)_100%)]" />

          <p className={`relative font-semibold uppercase text-sky-300/90 rise ${IS_TOUCH ? 'text-[10px] tracking-[0.2em]' : 'text-[11px] tracking-[0.45em]'}`}>Thời gian thực · không nhiệm vụ</p>
          <h1 className={`relative mt-4 font-bold uppercase tracking-[0.14em] text-white [text-shadow:0_4px_40px_rgba(56,189,248,0.35)] rise ${IS_TOUCH ? 'text-4xl' : 'text-6xl sm:text-7xl'}`} style={{ animationDelay: '60ms' }}>
            Thành phố
          </h1>
          <p className="relative mt-5 max-w-xl text-[13px] leading-relaxed text-slate-300 rise" style={{ animationDelay: '120ms' }}>
            Đi bộ qua những con phố lúc chạng vạng, nhìn mưa xuống và dòng xe chạy. Không điểm số,
            không thất bại — chỉ có thành phố và đồng hồ của nó.
          </p>

          <button
            className="relative mt-9 inline-flex items-center gap-3 rounded-full bg-sky-400 px-9 py-3.5 text-sm font-semibold uppercase tracking-[0.2em] text-slate-950 shadow-[0_0_50px_-10px_rgba(56,189,248,0.8)] transition hover:bg-sky-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100 rise"
            style={{ animationDelay: '180ms' }}
            onClick={startGame}
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
            Bắt đầu
          </button>
          <p className="relative mt-3 text-[11px] text-slate-400 rise" style={{ animationDelay: '220ms' }}>
            {IS_TOUCH ? 'Chạm vào thành phố để bắt đầu' : (<>hoặc nhấn <Key>Enter</Key> — vào game rồi bấm <Key>Esc</Key> để nhả chuột</>)}
          </p>

          <div className="relative mt-9 rise" style={{ animationDelay: '280ms' }}>
            <div className="mb-2 text-[11px] uppercase tracking-[0.2em] text-slate-400">Chất lượng hình ảnh</div>
            <div className="flex flex-wrap justify-center gap-1.5 text-[11px]">
              {TIER_LABELS.map((t) => (
                <button key={t.v} className={btn(tier === t.v)} onClick={() => patch({ tier: t.v })}>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="mt-2 text-[10px] text-slate-500">Máy yếu chọn “Thấp” — hậu kỳ sẽ tắt</div>
          </div>

          {!IS_TOUCH && (
          <div className="relative mt-8 flex flex-wrap justify-center gap-x-3 gap-y-1.5 text-[11px] text-slate-400 rise" style={{ animationDelay: '340ms' }}>
            {[['WASD', 'đi'], ['Shift', 'chạy'], ['Chuột', 'nhìn'], ['Con lăn', 'thu phóng'], ['E', 'lên/xuống xe'], ['O', 'quan sát'], ['P', 'dừng giờ'], ['F', 'chụp ảnh']].map(([k, d]) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <Key>{k}</Key>
                {d}
              </span>
            ))}
          </div>
          )}

          {stats && (
            <div className="absolute bottom-5 left-5 text-[10px] tabular-nums text-slate-500">
              {stats.fps.toFixed(0)} FPS · {(stats.tris / 1000).toFixed(0)}k tam giác
            </div>
          )}
        </div>
      )}

      <div className={`absolute inset-0 transition-opacity duration-200 ${photo || !started ? 'pointer-events-none opacity-0' : 'opacity-100'}`} style={{ zoom: a11y.hudScale }}>

      {IS_TOUCH && <TouchControls eng={eng} mode={mode} photo={photo} />}

      <MiniMap eng={eng} />
      <Compass eng={eng} />
      <PoiMarkers eng={eng} />
      <ContextHint eng={eng} started={started} intro={intro} setIntro={setIntro} />

      <div className={`absolute ${IS_TOUCH ? 'left-3 top-[max(3.5rem,calc(env(safe-area-inset-top)+2.75rem))] p-2' : 'left-4 top-4 w-52 p-3'} ${panel}`}>
        {IS_TOUCH ? (
          <span className="tabular-nums text-slate-100">{stats ? `${stats.fps.toFixed(0)} FPS` : '--'} · {fmtHour(hour)}</span>
        ) : (
          <>
            <div className="mb-2 text-[13px] font-semibold tracking-wide text-white">THÀNH PHỐ · MÔ PHỎNG</div>
            <Row k="FPS" v={stats ? stats.fps.toFixed(0) : '-'} warn={stats ? stats.fps < 30 : false} />
            <Row k="Giờ" v={`${fmtHour(hour)} · ${timeLabel(hour)}`} />
            <Row k="Chế độ" v={mode === 'player' ? 'đi bộ' : 'quan sát'} />
            <Row k="Tốc độ" v={stats ? `${stats.speed.toFixed(1)} m/s` : '-'} />
            <Row k="Vị trí" v={stats ? `${stats.x.toFixed(0)}, ${stats.z.toFixed(0)}` : '-'} />
            <Row k="Tam giác" v={stats ? `${(stats.tris / 1000).toFixed(0)}k` : '-'} />
          </>
        )}
      </div>

      {IS_TOUCH ? (
        <>
          {!sheet && (
            <button
              className={`absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] rounded-full border border-white/15 bg-black/55 px-4 py-2.5 text-[12px] font-medium text-slate-100 backdrop-blur`}
              onClick={() => setSheet(true)}
            >
              ⚙ Cấu hình
            </button>
          )}
          {sheet && (
            <div className="absolute inset-x-0 bottom-0 z-30 max-h-[72vh] overflow-y-auto rounded-t-2xl border-t border-white/10 bg-black/75 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-[11px] text-slate-200 backdrop-blur-md">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[13px] font-semibold text-white">Cấu hình</span>
                <button className={chip} onClick={() => setSheet(false)}>✕ Đóng</button>
              </div>
              <div className="space-y-3">{settings}</div>
            </div>
          )}
        </>
      ) : (
        <div className={`absolute right-4 top-4 max-h-[calc(100vh-2rem)] w-56 space-y-3 overflow-y-auto p-3 ${panel}`}>{settings}</div>
      )}

      {line && (
        <div
          key={line.n}
          className={`absolute bottom-16 left-1/2 max-w-[min(90vw,520px)] -translate-x-1/2 px-4 py-2.5 text-center text-[13px] text-slate-100 rise ${panel}`}
        >
          “{line.t}”
        </div>
      )}

      {tut >= 1 && tut <= 4 && (
        <div className={`absolute bottom-24 left-1/2 flex -translate-x-1/2 items-center gap-3 px-3 py-2 ${panel}`}>
          <span className="rounded bg-sky-400/90 px-1.5 py-0.5 text-[10px] font-bold text-slate-950">{tut}/4</span>
          <span className="text-[12px] text-slate-100">{TUTORIAL[tut - 1]}</span>
          <button className={chip} onClick={() => setTut(5)}>
            Bỏ qua
          </button>
        </div>
      )}

      <div className={`absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 text-center ${panel} ${IS_TOUCH ? 'hidden' : ''}`}>
        <span className="text-slate-300">WASD đi · Shift chạy/tăng tốc · chuột nhìn · con lăn thu phóng · E lên/xuống xe · E đạp xe · E vứt lon vào thùng · O đổi chế độ · P dừng giờ · F chụp ảnh</span>
        <div className="mt-0.5 text-slate-500">bấm vào thành phố để khoá con trỏ (Esc để thoát)</div>
      </div>
      </div>

      {ach && (
        <div
          key={ach.n}
          className="rise absolute left-1/2 top-10 -translate-x-1/2 rounded-md border border-sky-300/30 bg-black/60 px-3 py-1.5 text-[11px] font-medium text-sky-200 backdrop-blur-md"
        >
          {ach.t}
        </div>
      )}

      {IS_TOUCH && started && !photo && !sheet && !gallery && (
        <button
          className={`absolute bottom-[max(5rem,calc(env(safe-area-inset-bottom)+3.75rem))] right-3 rounded-full border border-white/15 bg-black/55 px-5 py-3 text-[12px] font-medium text-slate-100 backdrop-blur`}
          onClick={() => setPhoto(true)}
        >
          📷 Chụp
        </button>
      )}

      {photo && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className="rounded-sm border border-white/20"
            style={{ aspectRatio: AR, width: `min(96vw, calc(94vh * ${AR}))`, boxShadow: '0 0 0 100vmax rgba(0,0,0,0.55)' }}
          />
        </div>
      )}

      {photo && (
        <div className={`absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 w-[min(94vw,560px)] -translate-x-1/2 space-y-2.5 p-3 ${panel}`}>
          <div className="flex flex-wrap items-center justify-center gap-1.5">
            {(['16:9', '4:3', '1:1'] as Aspect[]).map((a) => (
              <button key={a} className={btn(aspect === a)} onClick={() => setAspect(a)}>{a}</button>
            ))}
            <button className={btn(pdof)} onClick={() => setPdof((v) => !v)}>🔘 Xóa phông</button>
          </div>

          <div className={`grid gap-2 ${pdof ? 'sm:grid-cols-2' : 'hidden'}`}>
            <Slider label={`Tiêu cự · ${pfocus} m`} value={pfocus} min={1} max={40} step={1} onChange={setPfocus} />
            <Slider label={`Độ mở ống kính ${(pap * 100).toFixed(0)}%`} value={pap} min={0.05} max={1} step={0.05} onChange={setPap} />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Slider label={`Độ sáng ${(pexp * 100).toFixed(0)}%`} value={pexp} min={0.5} max={1.6} step={0.02} onChange={setPexp} />
            <Slider label={`Tối góc ${(pvig * 100).toFixed(0)}%`} value={pvig} min={0} max={1} step={0.05} onChange={setPvig} />
          </div>

          <div className="flex flex-wrap justify-center gap-1.5">
            {Object.keys(PHOTO_PRESETS).map((n) => (
              <button key={n} className={chip} onClick={() => applyPhotoPreset(n)}>{n}</button>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              className="rounded-md bg-sky-400/90 px-4 py-2 text-xs font-medium text-slate-950"
              onClick={async () => {
                const [w, h] = ASPECT_SIZE[aspect]
                const url = await eng()?.capture(w, h)
                if (!url) return
                const hh = eng()?.hud()
                let place = 'Thành phố'
                if (hh) {
                  let bd = 55
                  for (const z of hh.zones) {
                    const d = Math.hypot(hh.x - z.x, hh.z - z.z)
                    if (d < bd) { bd = d; place = ZONE_NAME[z.kind] ?? place }
                  }
                }
                const shot = await watermark(url, `${place} · ${fmtHour(hour)}`)
                const a = document.createElement('a')
                a.href = shot
                a.download = `city-${Date.now()}.png`
                a.click()
                if (rain > 0.05 && !done.current.shot) {
                  done.current.shot = true
                  setAch((p) => ({ t: 'Thành tựu · Chụp ảnh trong mưa', n: (p?.n ?? 0) + 1 }))
                }
                const t = await thumb(shot)
                setShots((p) => {
                  const n = [t, ...p].slice(0, 12)
                  localStorage.setItem(SHOTS, JSON.stringify(n))
                  return n
                })
              }}
            >
              📷 Chụp {aspect}
            </button>
            <button
              className="rounded-md bg-white/10 px-4 py-2 text-xs font-medium text-white"
              onClick={() => setGallery(true)}
            >
              🖼 Thư viện ({shots.length})
            </button>
            {(Object.keys(FILTERS) as Filter[]).map((f) => (
              <button
                key={f}
                className={`rounded-md px-3 ${PAD} text-xs font-medium ${filter === f ? 'bg-sky-400/90 text-slate-950' : 'bg-white/10 text-white'}`}
                onClick={() => patch({ filter: f })}
              >
                {f}
              </button>
            ))}
            <button
              className="rounded-md bg-white/10 px-4 py-2 text-xs font-medium text-white"
              onClick={() => setPhoto(false)}
            >
              Đóng (F)
            </button>
          </div>

          <div className="text-center text-[10px] text-slate-400">Xóa phông / tối góc cần Chất lượng ≥ Trung bình · độ sáng cần bật “Màu”, tối góc cần bật “Hạt”.</div>
        </div>
      )}

      {gallery && (
        <div className="absolute inset-0 z-40 overflow-y-auto bg-black/85 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] backdrop-blur-sm">
          <div className="mb-4 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-white">THƯ VIỆN ẢNH · {shots.length}/12</span>
            <div className="flex gap-2">
              <button
                className="rounded-md bg-white/10 px-3 py-1.5 text-[11px] text-white"
                onClick={() => {
                  localStorage.removeItem(SHOTS)
                  setShots([])
                }}
              >
                Xoá hết
              </button>
              <button className="rounded-md bg-white/10 px-3 py-1.5 text-[11px] text-white" onClick={() => setGallery(false)}>
                ✕ Đóng
              </button>
            </div>
          </div>
          {shots.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
              {shots.map((s, i) => (
                <a key={i} href={s} download={`city-${i}.jpg`} className="block overflow-hidden rounded-md border border-white/10">
                  <img src={s} alt={`Ảnh ${i + 1}`} className="aspect-video w-full object-cover" />
                </a>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-slate-400">Chưa có ảnh. Vào chế độ chụp (F) rồi bấm 📷 4K.</div>
          )}
        </div>
      )}
    </div>
  )
}
