// The contract between the engine modules and React. Kept free of Three.js imports so the HUD can
// depend on it without dragging the renderer in.

export type Tier = 'low' | 'medium' | 'high' | 'ultra' | 'max'
export type Mode = 'player' | 'observe'

export interface Effects {
  shadows: boolean
  ao: boolean
  bloom: boolean
  rays: boolean
  grain: boolean
  grade: boolean
}

export interface Stats {
  fps: number
  hour: number
  mode: Mode
  speed: number
  x: number
  z: number
  tris: number
  paused: boolean
  inCar: boolean
  tier: Tier
}

// Snapshot of every URL-persistable setting. Engine is the single source of truth: React hydrates
// from getState() after createEngine() and writes it back to the URL, so shared links open the exact
// same city. mode here is the *intent* — the menu can force sim.mode to 'observe' for cinematic
// drift without changing what the URL records.
export interface EngineState {
  h: number
  rain: number
  tier: Tier
  mode: Mode
  bloom: number
  rays: number
  motion: number
  ca: number
  scale: number
  ambient: number
  adaptive: boolean
  filter: Filter
  effects: Effects
}

export const FILTERS = {
  none: { lift: 0.015, gamma: 0.98, gain: 1.02, sat: 1.08, tint: [1, 1, 1] },
  film: { lift: 0.035, gamma: 1.02, gain: 0.96, sat: 0.82, tint: [1.02, 1, 0.96] },
  noir: { lift: 0.02, gamma: 1.0, gain: 1.08, sat: 0, tint: [1, 1, 1.03] },
  warm: { lift: 0.02, gamma: 0.97, gain: 1.05, sat: 1.18, tint: [1.12, 1, 0.85] },
  cool: { lift: 0.01, gamma: 1.01, gain: 1.0, sat: 1.05, tint: [0.85, 0.98, 1.15] },
} as const
export type Filter = keyof typeof FILTERS

// Flags and scalars several systems read every frame. Each field is written by one module and read
// by others, which is why they live in one bag instead of being chased through constructor args.
export interface Sim {
  tier: Tier
  mode: Mode
  hour: number
  timeScale: number
  bloomGain: number
  raysGain: number
  motion: number
  ca: number
  paused: boolean
  idle: boolean
  inside: boolean
  sitting: boolean
  inCar: boolean
  inBike: boolean
  holdingCan: boolean
  rainTarget: number
  storm: number
  night: number
  dusk: number
  clock: number
  warmupT: number
  effects: Effects
  filter: Filter
  adaptive: boolean
  // D-look (photo mode, E9): only applied when a composer exists (tier medium+). dof renders an
  // extra depth pass every frame, so it stays off until the player asks for it in the camera panel.
  dof: boolean
  dofFocus: number
  dofAperture: number
  exposure: number
  vignette: number
  // E11 accessibility: motion/lightning off switches + remappable action keys (physical e.code)
  reduceMotion: boolean
  noLightning: boolean
  keymap: { interact: string; mode: string; pause: string; photo: string }
}
