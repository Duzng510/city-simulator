import { useEffect, useRef, useState } from 'react'
import { createEngine } from './engine/engine'
import type { Effects, EngineState, Stats } from './engine/types'
import { type Eng } from './ui/eng'

const DEFAULT_SETTINGS: EngineState = {
  h: 17.8, rain: 0, tier: 'low', mode: 'player', bloom: 1, rays: 1, motion: 0, ca: 0,
  scale: 240, ambient: 0.5, adaptive: false, filter: 'none',
  effects: { shadows: true, ao: true, bloom: true, rays: true, grain: true, grade: true },
}

// React chỉ giữ bản sao để hiển thị; engine là nguồn sự thật duy nhất. Mọi thay đổi đi qua
// patch() → engine.patchSettings (atomic: preset chỉ rebuild composer 1 lần) rồi đọc getState()
// back vào settings. Stats vẫn tới ~2.5Hz cho HUD realtime (fps/speed/paused).
export function useGame(onLine?: (t: string) => void) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engRef = useRef<Eng | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [settings, setSettings] = useState<EngineState>(DEFAULT_SETTINGS)

  useEffect(() => {
    let e: Eng | null = null
    const eng = createEngine(
      canvasRef.current!,
      (s) => {
        setStats(s)
        // tier có thể đổi khi adaptive tuning chạy; kéo settings mỗi stats tick để slider mirror
        // luôn phản ánh sim.tier/sim.paused thật.
        if (e) setSettings(e.getState())
      },
      onLine,
    )
    e = eng
    engRef.current = eng
    setSettings(eng.getState())
    // setIdle(true) mirror-đổi render sang observe cho menu drift; intent (settings.mode) giữ URL.
    eng.setIdle(true)
    return () => {
      eng.dispose()
      engRef.current = null
    }
  }, [])

  const eng = () => engRef.current

  const patch = (p: Partial<EngineState>) => {
    const e = engRef.current
    if (!e) return
    e.patchSettings(p)
    setSettings(e.getState())
  }

  const toggleFx = (k: keyof Effects) => {
    const next: Effects = { ...settings.effects, [k]: !settings.effects[k] }
    patch({ effects: next })
  }

  const togglePause = () => { eng()?.setPaused(!stats?.paused) }

  const startEngine = () => { engRef.current?.setIdle(false); engRef.current?.start() }

  useEffect(() => {
    const t = setTimeout(() => {
      const s = settings
      const q = new URLSearchParams()
      q.set('h', s.h.toFixed(2))
      if (s.rain > 0.01) q.set('rain', s.rain.toFixed(2))
      if (s.tier !== 'low') q.set('tier', s.tier)
      if (s.mode !== 'player') q.set('mode', s.mode)
      if (s.bloom !== 1) q.set('bloom', s.bloom.toFixed(2))
      if (s.rays !== 1) q.set('rays', s.rays.toFixed(2))
      if (s.motion > 0.01) q.set('motion', s.motion.toFixed(2))
      if (s.ca > 0.01) q.set('ca', s.ca.toFixed(2))
      if (s.scale !== 240) q.set('scale', String(s.scale))
      if (Math.abs(s.ambient - 0.5) > 0.01) q.set('ambient', s.ambient.toFixed(2))
      if (s.adaptive) q.set('adaptive', '1')
      if (s.filter !== 'none') q.set('filter', s.filter)
      const fxOff = (Object.keys(s.effects) as (keyof Effects)[]).filter((k) => !s.effects[k])
      if (fxOff.length) q.set('fx', fxOff.join(','))
      history.replaceState(null, '', `?${q.toString()}`)
    }, 500)
    return () => clearTimeout(t)
  }, [settings])

  return { canvasRef, eng, stats, settings, patch, toggleFx, togglePause, startEngine }
}
