import type { ReactNode } from 'react'

export function Key({ children }: { children: string }) {
  return (
    <kbd className="rounded border border-white/15 bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-slate-200">{children}</kbd>
  )
}

export function Row({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-slate-400">{k}</span>
      <span className={warn ? 'text-amber-400' : 'text-slate-100'}>{v}</span>
    </div>
  )
}

export function Slider({ label, value, min, max, step, onChange, children }: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  children?: ReactNode
}) {
  return (
    <label className="block">
      <span className="text-slate-400">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} className="mt-1 w-full"
        onChange={(e) => onChange(Number(e.target.value))} />
      {children}
    </label>
  )
}
