import { useEffect, useRef, useState } from 'react'
import { createEngine, type Effects, type Mode, type Stats, type Tier } from './engine/engine'
import { type Eng } from './ui/eng'

export function useGame(onLine?: (t: string) => void) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const engRef = useRef<Eng | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [tier, setTier] = useState<Tier>(() => (new URLSearchParams(location.search).get('tier') as Tier) || 'medium')
  const [mode, setMode] = useState<Mode>('player')
  const [hour, setHour] = useState(19.4)
  const [scale, setScale] = useState(240)
  const [bloom, setBloom] = useState(1)
  const [motion, setMotion] = useState(0)
  const [ca, setCa] = useState(0)
  const [rain, setRain] = useState(() => Number(new URLSearchParams(location.search).get('rain')) || 0)
  const [ambient, setAmbient] = useState(0.5)
  const [paused, setPaused] = useState(false)
  const [effects, setEffects] = useState<Effects>({ shadows: true, ao: true, bloom: true, grain: true, grade: true })

  useEffect(() => {
    const eng = createEngine(
      canvasRef.current!,
      (s) => {
        setStats(s)
        setPaused(s.paused)
        setHour(s.hour)
        setMode(s.mode)
        setTier((t) => (t === s.tier ? t : s.tier))
      },
      onLine,
    )
    engRef.current = eng
    eng.setEffects(effects)
    eng.setMode('observe')
    eng.setIdle(true)
    return () => {
      eng.dispose()
      engRef.current = null
    }
  }, [])

  // sync URL every 500ms when state settles
  useEffect(() => {
    const t = setTimeout(() => {
      const s = eng()?.getState()
      if (!s) return
      const q = new URLSearchParams()
      q.set('h', s.h.toFixed(2))
      if (s.rain > 0.01) q.set('rain', s.rain.toFixed(2))
      if (s.tier !== 'medium') q.set('tier', s.tier)
      if (s.mode !== 'player') q.set('mode', s.mode)
      if (s.bloom !== 1) q.set('bloom', s.bloom.toFixed(2))
      const fxOff = (Object.keys(s.effects) as (keyof Effects)[]).filter((k) => !s.effects[k])
      if (fxOff.length) q.set('fx', fxOff.join(','))
      history.replaceState(null, '', `?${q.toString()}`)
    }, 500)
    return () => clearTimeout(t)
  }, [hour, rain, tier, mode, bloom, effects, paused])

  const eng = () => engRef.current

  const setAll = {
    hour: (v: number) => { setHour(v); eng()?.setTime(v) },
    tier: (v: Tier) => { setTier(v); eng()?.setTier(v) },
    bloom: (v: number) => { setBloom(v); eng()?.setBloom(v) },
    motion: (v: number) => { setMotion(v); eng()?.setMotion(v) },
    ca: (v: number) => { setCa(v); eng()?.setCA(v) },
    rain: (v: number) => { setRain(v); eng()?.setRain(v) },
    scale: (v: number) => { setScale(v); eng()?.setTimeScale(v) },
    ambient: (v: number) => { setAmbient(v); eng()?.setAmbient(v) },
  }

  const toggleFx = (k: keyof Effects) => {
    const next = { ...effects, [k]: !effects[k] }
    setEffects(next)
    eng()?.setEffects(next)
  }

  const togglePause = () => { const p = !paused; setPaused(p); eng()?.setPaused(p) }

  const startEngine = () => {
    const e = engRef.current
    e?.setIdle(false)
    e?.setMode('player')
    e?.start()
  }

  return { canvasRef, eng, stats, tier, mode, hour, scale, bloom, motion, ca, rain, ambient, paused, effects, setAll, toggleFx, togglePause, startEngine }
}
