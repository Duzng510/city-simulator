import type * as THREE from 'three'
import { clamp } from './util'
import type { Mode, Sim } from './types'
import type { World } from './world'
import type { Observer } from './player'
import type { makeAmbient } from './audio'

export interface InputHooks {
  setMode: (m: Mode) => void
  interact: () => void
  togglePause: () => void
  resize: () => void
}

// Keyboard, mouse wheel and pointer lock. E/O/P are claimed here because they are global while
// playing; F/Enter/Esc belong to the React HUD and only fire when pointer lock is off.
export function makeInput(
  canvas: HTMLCanvasElement,
  sim: Sim,
  world: World,
  observer: Observer,
  ambient: ReturnType<typeof makeAmbient>,
  hooks: InputHooks,
  keys: Set<string>,
) {
  const { player } = world
  const isCoarse = window.matchMedia('(pointer: coarse)').matches
  const touchMove = { x: 0, z: 0, run: false }

  function applyLook(dx: number, dy: number) {
    const s = 0.0022
    const tgt = sim.mode === 'player' ? player : observer
    tgt.yaw -= dx * s
    tgt.pitch = clamp(tgt.pitch + dy * s, sim.mode === 'player' ? -0.55 : -1.3, sim.mode === 'player' ? 1.15 : 1.3)
  }

  const kd = (e: KeyboardEvent) => {
    if (e.code === 'Space') e.preventDefault()
    keys.add(e.code)
    const km = sim.keymap
    if (e.code === km.mode) hooks.setMode(sim.mode === 'player' ? 'observe' : 'player')
    if (e.code === km.pause) hooks.togglePause()
    if (e.code === km.interact && sim.mode === 'player' && !sim.idle && !sim.inside) hooks.interact()
  }
  const ku = (e: KeyboardEvent) => keys.delete(e.code)
  const mm = (e: MouseEvent) => {
    if (document.pointerLockElement !== canvas) return
    applyLook(e.movementX, e.movementY)
  }
  const wh = (e: WheelEvent) => {
    e.preventDefault()
    if (sim.mode === 'player') player.dist = clamp(player.dist + Math.sign(e.deltaY) * 0.45, 1.6, 12)
    else observer.fov = clamp(observer.fov - Math.sign(e.deltaY) * 3, 18, 82)
  }
  // hold RMB while framing (observe mode) to punch the lens in for a cinematic shot, release restores the wide view
  let adsFov = 0
  const mdn = (e: MouseEvent) => { if (e.button === 2 && sim.mode === 'observe' && !adsFov) { adsFov = observer.fov; observer.fov = clamp(adsFov * 0.4, 10, 82) } }
  const mup = (e: MouseEvent) => { if (e.button === 2 && adsFov) { observer.fov = adsFov; adsFov = 0 } }
  const ctxMenu = (e: Event) => e.preventDefault()
  const lock = () => {
    ambient.resume()
    if (!isCoarse && document.pointerLockElement !== canvas) canvas.requestPointerLock()
  }
  const onResize = () => hooks.resize()

  window.addEventListener('keydown', kd)
  window.addEventListener('keyup', ku)
  window.addEventListener('mousemove', mm)
  window.addEventListener('wheel', wh, { passive: false })
  window.addEventListener('mousedown', mdn)
  window.addEventListener('mouseup', mup)
  canvas.addEventListener('click', lock)
  canvas.addEventListener('contextmenu', ctxMenu)
  window.addEventListener('resize', onResize)

  function dispose() {
    window.removeEventListener('keydown', kd)
    window.removeEventListener('keyup', ku)
    window.removeEventListener('mousemove', mm)
    window.removeEventListener('wheel', wh)
    window.removeEventListener('mousedown', mdn)
    window.removeEventListener('mouseup', mup)
    canvas.removeEventListener('click', lock)
    canvas.removeEventListener('contextmenu', ctxMenu)
    window.removeEventListener('resize', onResize)
  }

  return { keys, touchMove, isCoarse, applyLook, lock, dispose }
}

export type Input = ReturnType<typeof makeInput>
