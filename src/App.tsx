import { useEffect, useRef, useState } from 'react'
import { FILTERS, type Effects, type Filter, type Tier } from './engine/engine'
import { useGame } from './useGame'
import { IS_TOUCH } from './ui/eng'
import { MiniMap, Compass, PoiMarkers, TouchControls } from './ui/hud'
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

const FX_LABELS: Record<keyof Effects, string> = { shadows: 'Bóng đổ', ao: 'AO', bloom: 'Bloom', grain: 'Hạt phim', grade: 'Màu' }

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

export default function App() {
  const [photo, setPhoto] = useState(false)
  const [filter, setFilter] = useState<Filter>('none')
  const [started, setStarted] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [line, setLine] = useState<{ t: string; n: number } | null>(null)
  const [shots, setShots] = useState<string[]>(loadShots)
  const [gallery, setGallery] = useState(false)
  const [tut, setTut] = useState(0)

  const { canvasRef, eng, stats, tier, mode, hour, scale, bloom, motion, ca, rain, ambient, paused, effects, setAll, toggleFx, togglePause, startEngine } =
    useGame((t) => setLine((p) => ({ t, n: (p?.n ?? 0) + 1 })))

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
  ]

  const PRESETS = {
    'Hoàng hôn': { h: 17.3, rain: 0, bloom: 1.0, tier: 'high' as Tier },
    'Đêm mưa': { h: 21.5, rain: 0.85, bloom: 1.5, tier: 'high' as Tier },
    'Giờ cao điểm': { h: 7.5, rain: 0, bloom: 0.8, tier: 'medium' as Tier },
    'Nửa đêm': { h: 0.5, rain: 0, bloom: 1.8, tier: 'ultra' as Tier },
  } as const

  const applyPreset = (p: typeof PRESETS[keyof typeof PRESETS]) => {
    setAll.hour(p.h); setAll.rain(p.rain); setAll.bloom(p.bloom); setAll.tier(p.tier)
  }

  const sliderCls = `mt-1 w-full rounded-md border border-white/10 bg-slate-900/80 px-2 ${PAD} text-slate-100 outline-none`

  const settings = (
    <>
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
        <select className={sliderCls} value={tier} onChange={(e) => setAll.tier(e.target.value as Tier)}>
          <option value="low">Thấp — tắt hậu kỳ</option>
          <option value="medium">Trung bình — AO nhẹ + bloom</option>
          <option value="high">Cao — 2048 bóng, AO rõ</option>
          <option value="ultra">Rất cao — 4096 bóng, ratio 1.6</option>
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

      <Slider label={`Thời gian thực (${scale}×)`} value={hour} min={0} max={23.99} step={0.01} onChange={setAll.hour}>
        <select className={sliderCls} value={scale} onChange={(e) => setAll.scale(Number(e.target.value))}>
          <option value={1}>1× — giờ thật</option>
          <option value={60}>60× — 24 phút/ngày</option>
          <option value={240}>240× — 6 phút/ngày</option>
          <option value={1200}>1200× — 72 giây/ngày</option>
        </select>
      </Slider>

      <Slider label={`Độ rực đèn (bloom) ${(bloom * 100).toFixed(0)}%`} value={bloom} min={0} max={2} step={0.05} onChange={setAll.bloom} />

      <Slider label={`Nhòe chuyển động ${(motion * 100).toFixed(0)}%`} value={motion} min={0} max={1} step={0.05} onChange={setAll.motion} />

      <Slider label={`Lệ màu viền ${(ca * 100).toFixed(0)}%`} value={ca} min={0} max={1} step={0.05} onChange={setAll.ca} />

      <Slider label={`Mưa ${(rain * 100).toFixed(0)}%`} value={rain} min={0} max={1} step={0.05} onChange={setAll.rain} />

      <Slider label={`Âm thanh nền ${(ambient * 100).toFixed(0)}%`} value={ambient} min={0} max={1} step={0.05} onChange={setAll.ambient} />
    </>
  )

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-950">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
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
                <button key={t.v} className={btn(tier === t.v)} onClick={() => setAll.tier(t.v)}>
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

      <div className={`absolute inset-0 transition-opacity duration-200 ${photo || !started ? 'pointer-events-none opacity-0' : 'opacity-100'}`}>

      {IS_TOUCH && <TouchControls eng={eng} mode={mode} />}

      <MiniMap eng={eng} />
      <Compass eng={eng} />
      <PoiMarkers eng={eng} />

      <div className={`absolute ${IS_TOUCH ? 'left-3 top-[max(0.75rem,env(safe-area-inset-top))] p-2' : 'left-4 top-4 w-52 p-3'} ${panel}`}>
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
        <div className={`absolute right-4 top-4 w-56 space-y-3 p-3 ${panel}`}>{settings}</div>
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

      {photo && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
          <button
            className="rounded-md bg-sky-400/90 px-4 py-2 text-xs font-medium text-slate-950"
            onClick={async () => {
              const url = await eng()?.capture(3840, 2160)
              if (!url) return
              const a = document.createElement('a')
              a.href = url
              a.download = `city-${Date.now()}.png`
              a.click()
              if (rain > 0.05 && !done.current.shot) {
                done.current.shot = true
                setAch((p) => ({ t: 'Thành tựu · Chụp ảnh trong mưa', n: (p?.n ?? 0) + 1 }))
              }
              const t = await thumb(url)
              setShots((p) => {
                const n = [t, ...p].slice(0, 12)
                localStorage.setItem(SHOTS, JSON.stringify(n))
                return n
              })
            }}
          >
            📷 4K
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
              className={`rounded-md px-3 py-2 text-xs font-medium ${filter === f ? 'bg-sky-400/90 text-slate-950' : 'bg-white/10 text-white'}`}
              onClick={() => {
                setFilter(f)
                eng()?.setFilter(f)
              }}
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
      )}

      {gallery && (
        <div className="absolute inset-0 z-40 overflow-y-auto bg-black/85 p-5 backdrop-blur-sm">
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
