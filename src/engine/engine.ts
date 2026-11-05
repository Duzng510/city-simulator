import * as THREE from 'three'
import { makeTextures } from './textures'
import { makeSpeedLines } from './fx'
import { makeRain } from './weather'
import { makeObserver } from './player'
import { clamp, disposeObject3D, disposeTextureTree } from './util'
import type { Effects, EngineState, Filter, Mode, Sim, Stats, Tier } from './types'
import { makeWorld } from './world'
import { N, SPAN, HALF, CELL, ROAD } from './city'
import { makeDressing } from './scene'
import { makeReflection } from './reflect'
import { makeQuality } from './quality'
import { makeCameraRig } from './camera'
import { makeVehicles } from './vehicle'
import { makeInteraction } from './interaction'
import { makeAudioRuntime } from './audioRuntime'
import { makeTimeline } from './timeline'
import { makeDistrictActivity } from './districtActivity'
import { makeInput, type InputHooks } from './input'
import { makeCapture } from './capture'
import { makeRuntime } from './runtime'

// Composition root. Each system lives in its own module; this file constructs them in the order
// their dependencies demand, reads the URL settings, and exposes the api React talks to.
export function createEngine(canvas: HTMLCanvasElement, onStats: (s: Stats) => void, onLine?: (t: string) => void) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(62, 1, 0.25, 1600)
  scene.fog = new THREE.FogExp2(0x9fb6cf, 0.0032)
  const speedLines = makeSpeedLines()
  camera.add(speedLines.lines)

  const tex = makeTextures(renderer.capabilities.getMaxAnisotropy())
  const world = makeWorld(scene, tex)
  const dressing = makeDressing(scene, tex)

  const q = new URLSearchParams(location.search)
  const rain = makeRain(tex.rain, Number(q.get('rain')) || 0)
  scene.add(rain.points, rain.splashes)

  const observer = makeObserver(new THREE.Vector3(world.city.spawn.x, 40, world.city.spawn.z + 30))

  const sim: Sim = {
    tier: 'low',
    mode: 'player',
    hour: Number(q.get('h')) || 17.8,
    timeScale: 240,
    bloomGain: 1,
    raysGain: 1,
    motion: 0,
    ca: 0,
    paused: false,
    idle: false,
    inside: false,
    sitting: false,
    inCar: false,
    inBike: false,
    holdingCan: false,
    rainTarget: rain.amount,
    storm: 0,
    night: 0,
    dusk: 0,
    clock: 0,
    warmupT: 0,
    effects: { shadows: true, ao: true, bloom: true, rays: true, grain: true, grade: true },
    filter: 'none',
    adaptive: q.get('adaptive') === '1',
    dof: false,
    dofFocus: 12,
    dofAperture: 0.6,
    exposure: 1,
    vignette: 0.45,
    reduceMotion: false,
    noLightning: false,
    keymap: { interact: 'KeyE', mode: 'KeyO', pause: 'KeyP', photo: 'KeyF' },
  }

  const keys = new Set<string>()
  const rig = makeCameraRig(camera, sim, world, observer)
  const veh = makeVehicles(camera, sim, world, rig, keys)
  const sfx = makeAudioRuntime(sim, world, camera, veh)
  const act = makeInteraction(camera, scene, sim, world, dressing, rig, veh, rain, sfx.ambient, onLine)
  const refl = makeReflection(renderer, scene, camera, world.city)
  const quality = makeQuality(canvas, renderer, scene, camera, sim, dressing, refl, onLine)
  const time = makeTimeline(renderer, scene, camera, sim, dressing, world, observer, quality, rain, sfx.ambient)
  const activity = makeDistrictActivity(world.city)
  const capture = makeCapture(canvas, sim, quality, time)

  const hooks: InputHooks = {
    setMode: (m: Mode) => api.setMode(m),
    interact: () => act.interact(),
    togglePause: () => { sim.paused = !sim.paused },
    resize: () => quality.resize(),
  }
  const input = makeInput(canvas, sim, world, observer, sfx.ambient, hooks, keys)

  // initial overrides from URL
  if (q.get('tier')) sim.tier = q.get('tier') as Tier
  if (q.get('mode')) sim.mode = q.get('mode') as Mode
  if (q.get('bloom')) sim.bloomGain = clamp(Number(q.get('bloom')), 0, 2)
  if (q.get('rays')) sim.raysGain = clamp(Number(q.get('rays')), 0, 2)
  if (q.get('scale')) sim.timeScale = Number(q.get('scale')) || 240
  if (q.get('motion')) sim.motion = clamp(Number(q.get('motion')), 0, 1)
  if (q.get('ca')) sim.ca = clamp(Number(q.get('ca')), 0, 1) * 0.0025
  if (q.get('filter')) sim.filter = q.get('filter') as Filter
  const fxOff = (q.get('fx') || '').split(',').filter(Boolean)
  if (fxOff.length) {
    sim.effects = { ...sim.effects, ...Object.fromEntries(fxOff.map((k) => [k, false])) } as Effects
  }
  if (q.get('ambient')) sfx.setVolume(clamp(Number(q.get('ambient')), 0, 1))

  // Menu (idle) drifts the camera via the observe rig; intentMode records what the URL should
  // carry, so a shared ?mode=player link still enters player mode on Start instead of being
  // stomped by the mount-time menu.
  let intentMode: Mode = sim.mode

  quality.applyTier()
  time.skyFor(sim.hour)
  time.primeEnv()
  const runtime = makeRuntime({
    renderer, scene, camera, sim, world, dressing, rig, veh, act, input, sfx, time, activity, quality, refl, capture,
    observer, speedLines, rain, onStats,
  })
  runtime.start()

  const api = {
    patchSettings(p: Partial<EngineState>) {
      let needsTier = false
      let needsFilter = false
      if (p.h !== undefined) sim.hour = p.h
      if (p.rain !== undefined) sim.rainTarget = clamp(p.rain, 0, 1)
      if (p.bloom !== undefined) sim.bloomGain = p.bloom
      if (p.rays !== undefined) sim.raysGain = clamp(p.rays, 0, 2)
      if (p.motion !== undefined) sim.motion = clamp(p.motion, 0, 1)
      if (p.ca !== undefined) { sim.ca = clamp(p.ca, 0, 1) * 0.0025; needsFilter = true }
      if (p.scale !== undefined) sim.timeScale = p.scale
      if (p.ambient !== undefined) sfx.setVolume(clamp(p.ambient, 0, 1))
      if (p.adaptive !== undefined) sim.adaptive = p.adaptive
      if (p.filter !== undefined && p.filter !== sim.filter) { sim.filter = p.filter; needsFilter = true }
      if (p.tier !== undefined && p.tier !== sim.tier) { sim.tier = p.tier; sim.adaptive = false; needsTier = true }
      if (p.effects !== undefined) { sim.effects = p.effects; needsTier = true }
      // composer rebuild is expensive; a preset that flips tier + effects + ca should still only
      // rebuild once at the end
      if (needsTier) quality.applyTier()
      else if (needsFilter) quality.applyFilter()
    },
    setPhoto(p: Partial<Pick<Sim, 'dof' | 'dofFocus' | 'dofAperture' | 'exposure' | 'vignette'>>) {
      if (p.dof !== undefined) sim.dof = p.dof
      if (p.dofFocus !== undefined) sim.dofFocus = p.dofFocus
      if (p.dofAperture !== undefined) sim.dofAperture = p.dofAperture
      if (p.exposure !== undefined) sim.exposure = p.exposure
      if (p.vignette !== undefined) sim.vignette = p.vignette
      quality.applyPhoto()
    },
    setA11y(p: Partial<Pick<Sim, 'reduceMotion' | 'noLightning' | 'keymap'>>) {
      if (p.reduceMotion !== undefined) sim.reduceMotion = p.reduceMotion
      if (p.noLightning !== undefined) sim.noLightning = p.noLightning
      if (p.keymap !== undefined) sim.keymap = { ...sim.keymap, ...p.keymap }
    },
    setVolumes(v: Partial<Record<'ambience' | 'vehicles' | 'weather' | 'interaction' | 'footsteps', number>>) {
      sfx.setVolumes(v)
    },
    setMode(m: Mode) {
      if (sim.inside) return
      intentMode = m
      if (sim.idle || m === sim.mode) return
      if (sim.inCar) veh.toggleCar()
      if (sim.inBike) veh.toggleBike()
      if (sim.sitting) rig.sitStop()
      if (m === 'observe') {
        observer.pos.copy(camera.position)
        observer.yaw = world.player.yaw
        observer.pitch = world.player.pitch
      }
      sim.mode = m
    },
    setPaused(p: boolean) {
      sim.paused = p
    },
    resetCamera() {
      rig.reset()
    },
    setIdle(v: boolean) {
      if (v === sim.idle) return
      sim.idle = v
      // Menu drift only runs in the observe branch; mirror it on sim.mode without touching
      // intentMode so a shared URL keeps its mode=player/observe through the whole flow.
      if (v) {
        if (sim.mode !== 'observe') {
          observer.pos.copy(camera.position)
          observer.yaw = world.player.yaw
          observer.pitch = world.player.pitch
          sim.mode = 'observe'
        }
      } else if (sim.mode !== intentMode) {
        if (intentMode === 'observe') {
          observer.pos.copy(camera.position)
          observer.yaw = world.player.yaw
          observer.pitch = world.player.pitch
        }
        sim.mode = intentMode
      }
    },
    start() {
      input.lock()
    },
    setMove(x: number, z: number, run: boolean) {
      input.touchMove.x = x
      input.touchMove.z = z
      input.touchMove.run = run
    },
    look(dx: number, dy: number) {
      input.applyLook(dx, dy)
    },
    resumeAudio() {
      sfx.resume()
    },
    // deterministic framing for the headless verify harness: drive the observe camera, then capture()
    cam(x: number, y: number, z: number, yaw: number, pitch: number, fov: number) {
      sim.mode = 'observe'
      sim.idle = false
      observer.pos.set(x, y, z)
      observer.yaw = yaw
      observer.pitch = clamp(pitch, -1.3, 1.3)
      observer.fov = clamp(fov, 18, 82)
      observer.apply(camera)
    },
    getState(): EngineState {
      return {
        h: sim.hour,
        rain: sim.rainTarget,
        tier: sim.tier,
        mode: intentMode,
        bloom: sim.bloomGain,
        rays: sim.raysGain,
        motion: sim.motion,
        ca: sim.ca / 0.0025,
        scale: sim.timeScale,
        ambient: sfx.ambient.volume,
        adaptive: sim.adaptive,
        filter: sim.filter,
        effects: sim.effects,
      }
    },
    hud: () => rig.hud(),
    hint: () => act.hint(),
    project: (x: number, y: number, z: number) => rig.project(canvas, x, y, z),
    // minimap cần hình học lưới phố; cho nó đi qua api thay vì import thẳng city.ts
    grid: () => ({ N, SPAN, HALF, CELL, ROAD }),
    // E10: static POI points per minimap layer (fetched once by the HUD, never per frame)
    pois: () => ({
      shops: world.city.doorSpots.map((d) => ({ x: d.hx, z: d.hz })),
      benches: world.city.benches,
      bikes: world.city.bikeRacks,
      food: [...world.city.vending, ...world.city.carts],
      busker: { x: world.busX, z: world.busZ },
    }),
    capture: (w: number, h: number) => capture.request(w, h),
    dispose() {
      runtime.stop()
      input.dispose()
      act.dispose()
      quality.teardownComposer()
      time.dispose()
      refl.free()
      sfx.dispose()
      // scene đã chứa camera (fadeQuad + speedLines) và mọi mesh của city/ents/props/wildlife/
      // rain/dressing — một lần traverse thay cho enumerating từng mesh, đỡ sót khi thêm system mới
      disposeObject3D(scene)
      disposeTextureTree(tex)
      renderer.dispose()
    },
  }
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) (window as unknown as { __sim: typeof api }).__sim = api
  return api
}
